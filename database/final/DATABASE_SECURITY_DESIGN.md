# DATABASE SECURITY DESIGN — SISTEM ASRAMA PRESENSI

## 1. Ringkasan Arsitektur Keamanan

Sistem **Asrama Presensi** menerapkan arsitektur **Zero Direct Frontend Access** dengan pertahanan berlapis (*Defense-in-Depth*) pada Supabase PostgreSQL 17:

1. **Autentikasi Mandiri di Spring Boot:**
   - Autentikasi menggunakan tabel `public.users` (`password_hash` BCrypt/Argon2) dan JWT yang ditandatangani oleh Spring Boot (bukan Supabase Auth).
2. **Pencabutan Penuh Hak Akses Publik (`PUBLIC`, `anon`, `authenticated`):**
   - Seluruh hak akses tabel, sequence, dan fungsi pada skema `public` telah dicabut (`REVOKE ALL`) dari `PUBLIC`, `anon`, dan `authenticated`, termasuk melalui `ALTER DEFAULT PRIVILEGES`.
   - Permintaan langsung ke PostgREST menggunakan `anon` key atau token publik ditolak di tingkat privilege tabel sebelum menyentuh data.
3. **Role Khusus Backend (`app_backend`) dengan Prinsip *Least Privilege*:**
   - `app_backend` dikonfigurasi dengan `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`.
   - Tidak memiliki hak `TRUNCATE` pada tabel mana pun.
   - Tidak memiliki hak `DELETE` pada tabel riwayat dan operasional kritis (`attendance_records`, `violations`, `semester_evaluations`, `coaching_records`, `help_requests`).
   - Hanya memiliki hak `SELECT, INSERT` (tanpa `UPDATE` atau `DELETE`) pada tabel log/histori immutable (`audit_logs`, `attendance_record_history`, `violation_point_history`, `attendance_validation_logs`, `help_request_updates`).
4. **Row Level Security (RLS) Aktif di Seluruh 26 Tabel `public` + `storage.objects`:**
   - Total **84 policy** pada skema `public` (1 policy permisif per aksi per tabel, ditargetkan khusus `TO app_backend`) dan **4 policy** pada `storage.objects`.

---

## 2. Integrasi JWT Spring Boot & Identitas Transaksi Aman

Karena koneksi JDBC pada Spring Boot menggunakan *connection pool* (HikariCP), identitas pengguna **wajib bersifat transaction-scoped** (`SET LOCAL` / `set_config(..., true)`) agar tidak pernah bocor antar-request.

### Mekanisme Pengikatan Identitas (`public.set_app_context`)

Pada awal setiap transaksi `@Transactional`, backend memanggil:

```sql
SELECT public.set_app_context(
  p_user_id    := :userId,        -- UUID dari klaim 'sub' JWT yang telah diverifikasi signature-nya oleh Spring Boot
  p_jwt_claims := :jwtClaimsJsonb -- Opsional: payload JSONB klaim JWT untuk validasi silang
);
```

### Pencegahan Manipulasi Role & User ID (Anti-Spoofing)

Ketiga fungsi resolver identitas RLS (`public.current_app_user_id()`, `public.current_app_role()`, `public.current_app_resident_id()`) didefinisikan sebagai `STABLE SECURITY DEFINER` dengan `SET search_path = public, pg_catalog`:

1. **Verifikasi Real-Time ke Tabel `public.users`:**
   - `current_app_user_id()` memeriksa apakah `users.id` benar-benar ada di database, `is_active = true`, dan tidak sedang terkunci (`locked_until IS NULL OR locked_until <= now()`). Jika akun dinonaktifkan atau dikunci setelah JWT diterbitkan, akses database otomatis ditolak saat itu juga.
2. **Deteksi Manipulasi Klaim (`42501` Insufficient Privilege):**
   - `current_app_role()` selalu mengambil `role` otoritatif dari `public.users`. Apabila variabel sesi `app.current_user_role` atau klaim `request.jwt.claims` disetel berbeda dengan `users.role` di database, fungsi langsung melempar exception `Security violation: role claim mismatch with database`.
   - `current_app_resident_id()` memvalidasi `resident_id` terhadap `public.users.resident_id` dan melempar exception `Security violation: resident_id claim mismatch with database` jika terdapat ketidaksesuaian.
3. **Proteksi Kolom Sensitif (`trg_protect_user_columns`):**
   - Trigger `BEFORE UPDATE ON public.users` mencegah pengguna non-`ADMIN` mengubah kolom `role`, `resident_id`, `is_active`, atau `username` pada baris miliknya sendiri.

---

## 3. Matriks Hak Akses Role (4 Role Utama)

| Kelompok Tabel | `PENGHUNI` | `MONITOR` | `VILLAGE_DEAN` | `ADMIN` |
|---|---|---|---|---|
| `residents` | `SELECT` diri sendiri | `SELECT` semua | `SELECT`, `UPDATE` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `users` | `SELECT`, `UPDATE` (diri sendiri, non-role) | `SELECT`, `UPDATE` (diri sendiri) | `SELECT`, `UPDATE` (diri sendiri) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `consent_records`, `face_enrollments` | `SELECT`, `INSERT`, `UPDATE` diri sendiri | `SELECT` semua | `SELECT` semua | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `enrollment_photos` | `SELECT`, `INSERT`, `UPDATE` milik sendiri | `SELECT` semua | - | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `face_profiles` | `SELECT` diri sendiri (+ promosi via RPC) | Akses via fungsi `SECURITY DEFINER` | - | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `face_profile_history` | Ditolak | Ditolak | Ditolak | `ALL` (Retensi biometrik) |
| `attendance_schedules`, `attendance_sessions`, `geofence_settings` | `SELECT` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `SELECT` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `attendance_records` | `SELECT`, `INSERT` (`SCAN` diri sendiri) | `SELECT`, `INSERT` (`MANUAL`/`DIBANTU_PENJAGA`), `UPDATE` | `SELECT`, `UPDATE` | `SELECT`, `INSERT`, `UPDATE` |
| `attendance_record_history`, `violation_point_history` | `SELECT` milik sendiri | `SELECT` semua | `SELECT` semua | `SELECT` semua |
| `attendance_validation_logs` | `SELECT`, `INSERT` milik sendiri | `SELECT`, `INSERT` | `SELECT` | `SELECT`, `INSERT` |
| `audit_logs` | Ditolak | `SELECT`, `INSERT` | `SELECT`, `INSERT` | `SELECT`, `INSERT` |
| `violations` | `SELECT` milik sendiri | `SELECT`, `INSERT`, `UPDATE` | `SELECT`, `INSERT`, `UPDATE` | `SELECT`, `INSERT`, `UPDATE` |
| `semester_evaluations`, `coaching_records` | `SELECT` milik sendiri | `SELECT` | `SELECT`, `INSERT`, `UPDATE` | `SELECT`, `INSERT`, `UPDATE` |
| `emergency_contacts` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` milik sendiri | `SELECT` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `help_requests`, `help_request_updates` | `SELECT`, `INSERT` (`PERMINTAAN_BANTUAN` milik sendiri) | `SELECT`, `INSERT`, `UPDATE` (`LAPORAN_TINDAK_LANJUT` / ditugaskan) | `SELECT`, `INSERT`, `UPDATE` | `SELECT`, `INSERT`, `UPDATE` |

---

## 4. Perlindungan Data Biometrik & Sensitif

1. **Embedding Wajah (`vector(512)` ArcFace):**
   - Disimpan sebagai tipe native `vector(512)` (`pgvector`) dengan indeks HNSW (`vector_cosine_ops`).
   - Operasi pencocokan wajah (`public.find_similar_face` dan `public.face_similarity`) dieksekusi di dalam database dan hanya mengembalikan skor kemiripan (`float8`), sehingga vektor embedding mentah tidak pernah perlu dikirim ke frontend (memenuhi **K-01** dan **P-10**).
   - Trigger `audit_row_change()` secara eksplisit menghapus kunci `password_hash`, `candidate_embedding`, dan `embedding` sebelum menyimpan snapshot JSONB ke `audit_logs`.
2. **Deteksi Wajah Ganda (`S-05`) & Re-Enrollment Aman (`P-10`):**
   - Trigger `validate_completed_enrollment()` memeriksa kemiripan `candidate_embedding` terhadap seluruh penghuni aktif lain menggunakan `find_similar_face()` dan menolak pendaftaran dengan pesan `'Wajah sudah terdaftar'` bila melampaui ambang batas.
   - Fungsi `promote_enrollment()` mengarsipkan profil lama ke `face_profile_history` (dengan masa retensi `retention_until`) sebelum mengganti `face_profiles`, serta mengosongkan `candidate_embedding`.

---

## 5. Keamanan Supabase Storage

1. **Konfigurasi Bucket:**
   - Bucket `face-enrollments` (serta alias `face-enrollment`) dikonfigurasi `public = false` (Private), batas ukuran file `5 MB` (`5242880` byte), dan MIME type terbatas pada `image/jpeg`, `image/png`, `image/webp`.
2. **Validasi Struktur Path Ketat:**
   - Baik pada tabel `public.enrollment_photos` (constraint `photo_path_format` + trigger `validate_enrollment_photo`) maupun pada policy `storage.objects`, path objek wajib mematuhi pola:
     `{resident_id}/{enrollment_id}/{front|left|right|up|down}.jpg`
3. **Isolasi Akses Objek (`storage.objects`):**
   - `PENGHUNI` hanya dapat mengunggah/melihat objek pada folder `{resident_id}` miliknya sendiri (`(storage.foldername(name))[1] = public.current_app_resident_id()::text`).
   - `MONITOR` dan `ADMIN` dapat membaca foto untuk keperluan verifikasi/audit, dan hanya `ADMIN` yang dapat menghapus objek.
