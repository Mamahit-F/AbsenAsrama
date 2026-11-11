# DATABASE DEPLOYMENT & INTEGRATION GUIDE — ASRAMA PRESENSI

## 1. Informasi Lingkungan Database

- **Supabase Project Name:** `asrama-presensi`
- **Project Reference ID:** `tjgttljfdlcwxbregzqs`
- **PostgreSQL Engine:** PostgreSQL 17 (`17.11.0.018`)
- **Zona Waktu Operasional:** `Asia/Makassar` (WITA / UTC+8)
- **Ekstensi Aktif:** `vector` (0.8.2), `postgis`, `btree_gist`, `pgcrypto`, `uuid-ossp`

---

## 2. Urutan Penerapan Migration

Seluruh perubahan telah diterapkan langsung pada project Supabase `tjgttljfdlcwxbregzqs`. Untuk menerapkan pada environment baru (staging/DR), tersedia dua opsi:

### Opsi A: Satu Paket Lengkap (Direkomendasikan untuk Environment Baru)
Jalankan satu file idempotent berikut melalui Supabase SQL Editor atau `psql`:
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f database/final/FINAL_DATABASE_SETUP.sql
```

### Opsi B: Bertahap per File Migration
Jalankan secara berurutan dari folder `database/migrations/`:
1. `V001_initial_schema.sql` — Struktur dasar 12 tabel utama dan tipe ENUM awal.
2. `V002_types_extensions.sql` — Ekstensi `postgis` & `btree_gist`, ENUM tambahan, dan zona waktu `Asia/Makassar`.
3. `V003_core_extensions.sql` — Perluasan kolom tabel utama, indeks HNSW `pgvector`, kolom geografi PostGIS, dan constraint anti-tumpang-tindih sesi.
4. `V004_new_tables.sql` — 14 tabel pendukung (konfigurasi kegiatan, pengecualian/libur, riwayat presensi, pelanggaran, evaluasi semester, pembinaan, kontak darurat, permintaan bantuan) beserta aktivasi RLS.
5. `V005_functions_triggers_seed.sql` — Fungsi konteks JWT Spring Boot, fungsi autentikasi/lockout, fungsi domain presensi/wajah/geofence, trigger audit & imutabilitas, serta seed data awal.
6. `V006_security_roles_rls_storage.sql` — Role `app_backend`, pencabutan hak akses `PUBLIC`/`anon`/`authenticated`, covering index seluruh FK, 84 policy RLS tabel `public`, dan 4 policy RLS `storage.objects`.

### Verifikasi Pasca-Deployment
Jalankan skrip verifikasi otomatis (berjalan di dalam transaksi `ROLLBACK` sehingga tidak meninggalkan data sampah):
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f database/final/FINAL_DATABASE_VERIFICATION.sql
```

---

## 3. Panduan Integrasi Backend Spring Boot

### A. Konfigurasi Koneksi & Transaksi RLS

Pada setiap transaksi database yang menangani request pengguna terautentikasi, Spring Boot wajib mengaktifkan role `app_backend` dan mengikat identitas pengguna dari JWT yang telah diverifikasi:

```sql
SET LOCAL ROLE app_backend;
SELECT public.set_app_context(
  :userId::uuid,
  :jwtClaimsJson::jsonb -- contoh: '{"sub":"...","role":"PENGHUNI","resident_id":"..."}'
);
```

> **Penting:** Selalu gunakan `SET LOCAL ROLE app_backend` dan `public.set_app_context(...)` di dalam blok `@Transactional`. Karena menggunakan `SET LOCAL` (`is_local = true`), pengaturan otomatis di-reset oleh PostgreSQL ketika transaksi selesai (`COMMIT` / `ROLLBACK`) dan aman untuk *connection pool* HikariCP.

### B. Kontrak Fungsi Autentikasi & Akun (Sebelum Login)

1. **Pendaftaran Akun Penghuni (`P-01`):**
   ```sql
   SELECT public.register_resident_account(
     p_nim           := :nim,
     p_full_name     := :fullName,
     p_password_hash := :bcryptHash,
     p_email         := :email
   );
   ```
2. **Lookup Login (`P-01`, `J-01`, `A-01`):**
   ```sql
   SELECT * FROM public.get_user_for_login(:identifier);
   ```
   - Periksa kolom `is_active` dan `is_locked` (`locked_until > now()`).
3. **Pencatatan Hasil Login (`A-01`, `A-04`):**
   - Jika password salah: `SELECT public.register_login_failure(:userId);` (otomatis mengunci 5 menit pada kegagalan ke-5 berturut-turut).
   - Jika password benar: `SELECT public.register_login_success(:userId);`

### C. Kontrak Face Enrollment & Pengenalan Wajah (FastAPI + Spring Boot)

1. **Persetujuan Data Wajah (`P-05`):**
   - Insert ke `public.consent_records(resident_id, consent_version, evidence_path)`.
2. **Memulai Enrollment & Unggah 5 Pose (`P-02`, `P-03`, `P-04`):**
   - Insert ke `public.face_enrollments(resident_id, status, consent_id)` dengan status `'PENDING'`.
   - Unggah 5 foto ke Supabase Storage bucket `face-enrollments` menggunakan Service Role di sisi server dengan path:
     `{resident_id}/{enrollment_id}/{front|left|right|up|down}.jpg`
   - Simpan hasil pemeriksaan kualitas & liveness per pose ke `public.enrollment_photos`.
3. **Finalisasi & Promosi Embedding (`S-05`, `P-10`):**
   - Update `public.face_enrollments` menjadi `status = 'COMPLETED'`, `candidate_embedding = :vec512`, `model_version = 'ArcFace-r100'`. Trigger database otomatis memeriksa:
     - Kelengkapan 5 pose lolos kualitas & liveness,
     - Keberadaan consent aktif,
     - Tidak adanya kemiripan wajah di atas ambang batas dengan penghuni aktif lain (`S-05`: menolak dengan `'Wajah sudah terdaftar'`).
   - Panggil `SELECT public.promote_enrollment(:enrollmentId);` untuk memindahkan embedding ke `public.face_profiles` dan mengarsipkan profil lama ke `public.face_profile_history`.
4. **Verifikasi Wajah saat Presensi (`P-07`, `J-05`, `S-03`, `S-04`):**
   - Scan mandiri (1:1 atau 1:N): `SELECT public.face_similarity(:residentId, :scanEmbedding);` atau `SELECT * FROM public.find_similar_face(:scanEmbedding, :threshold, NULL, 1);`
   - Scan dibantu penjaga (`J-05`): wajib menggunakan `SELECT public.face_similarity(:selectedResidentId, :scanEmbedding);` untuk memastikan wajah cocok dengan penghuni yang dipilih penjaga.

### D. Kontrak Jadwal, Sesi, Geofence, & Presensi

1. **Membentuk Sesi dari Jadwal Berulang (`J-06`):**
   ```sql
   SELECT public.materialize_sessions(:scheduleId, :fromDate, :toDate, :actorUserId);
   ```
2. **Validasi Geofence (`E`):**
   ```sql
   SELECT * FROM public.check_geofence(:sessionId, :latitude, :longitude, :accuracyM);
   ```
3. **Menutup Sesi & Mencatat Ketidakhadiran Otomatis (`H`):**
   ```sql
   SELECT public.generate_absences(:sessionId, :monitorUserId);
   ```
   - Otomatis membuat baris `TIDAK_HADIR` bagi penghuni aktif yang wajib mengikuti sesi tersebut (memperhatikan `activity_requirements` dan `activity_exemptions`) serta menghitung poin pelanggaran otomatis di `public.violations`.
