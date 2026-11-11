# BACKEND DATABASE CONTRACT — ASRAMA PRESENSI

Dokumen ini mendefinisikan kontrak integrasi penuh antara **Spring Boot Backend**, **Python FastAPI AI Service**, dan database **Supabase PostgreSQL 17** (`tjgttljfdlcwxbregzqs`, Region: `ap-southeast-1`, Timezone: `Asia/Makassar` WITA).

---

## 1. Arsitektur Koneksi & Role Database

### A. Role Transaksi Backend (`app_backend`)
- **Atribut Role:** `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `rolbypassrls = false`.
- **Anggota Role (`pg_auth_members`):** `authenticator`, `postgres`, `service_role`.
- **Mekanisme Eksekusi:**
  Setiap koneksi dari backend melakukan autentikasi login menggunakan akun database (`postgres.tjgttljfdlcwxbregzqs`) melalui connection pooler port 5432. Di awal setiap transaksi `@Transactional`, backend mengeksekusi:
  ```sql
  SET LOCAL ROLE app_backend;
  SELECT public.set_app_context(:userId::uuid, :jwtClaimsJson::jsonb);
  ```
- **Sifat Transaksional (`SET LOCAL`):**
  Perubahan role dan setting sesi (`app.current_user_id`, `app.current_user_role`, `app.current_resident_id`, `request.jwt.claims`) hanya berlaku selama durasi transaksi PostgreSQL aktif. Saat transaksi berakhir (`COMMIT` atau `ROLLBACK`), seluruh setting otomatis dibersihkan dan koneksi kembali ke role default, mencegah kebocoran konteks pada HikariCP.

---

## 2. Struktur 26 Tabel & Kebijakan Row Level Security (RLS)

Seluruh 26 tabel pada skema `public` memiliki `ROW LEVEL SECURITY ENABLED` (`relrowsecurity = true` dan `relforcerowsecurity = true`):

| No | Nama Tabel | Kolom Kunci / Deskripsi | Kebijakan RLS Utama |
|---|---|---|---|
| 1 | `public.users` | `id`, `resident_id`, `username`, `email`, `password_hash`, `role`, `is_active`, `failed_login_attempts`, `locked_until` | Admin dapat mengelola semua; pengguna hanya dapat membaca profil dirinya sendiri (`id = current_app_user_id()`). |
| 2 | `public.residents` | `id`, `nim`, `full_name`, `status`, `residence_category`, `building`, `room_number` | Staff (`ADMIN`, `MONITOR`, `VILLAGE_DEAN`) dapat membaca; `PENGHUNI` hanya dapat membaca baris miliknya (`id = current_resident_id()`). |
| 3 | `public.face_profiles` | `id`, `resident_id`, `embedding` (`vector(512)`), `model_version`, `enrolled_at`, `is_active` | Vektor embedding terisolasi ketat di level DB; hanya diakses melalui fungsi `face_similarity` dan `find_similar_faces`. |
| 4 | `public.face_profile_history` | `id`, `resident_id`, `old_embedding`, `archived_at`, `retention_until` | Arsip biometrik lama saat re-enrollment; otomatis dibersihkan oleh `purge_expired_face_data()`. |
| 5 | `public.face_enrollments` | `id`, `resident_id`, `consent_id`, `status`, `candidate_embedding`, `started_at`, `completed_at` | Menampung sesi enrollment aktif; divalidasi oleh trigger `trg_validate_enrollment`. |
| 6 | `public.enrollment_photos` | `id`, `enrollment_id`, `pose_type`, `storage_bucket`, `storage_path`, `quality_score`, `liveness_score`, `quality_passed`, `liveness_passed` | Foto 5 pose; check constraint `photo_quality_range` & `photo_liveness_range` `[0.0, 1.0]`. |
| 7 | `public.consent_records` | `id`, `resident_id`, `consent_version`, `consented_at`, `revoked_at`, `evidence_path` | Persetujuan biometrik (`P-05`); penghuni hanya dapat melihat dan menyetujui miliknya sendiri. |
| 8 | `public.resident_emergency_contacts` | `id`, `resident_id`, `full_name`, `relationship`, `phone`, `is_primary` | Kontak darurat penghuni asrama. |
| 9 | `public.activity_types` | `id`, `code`, `name`, `description`, `is_active` | Master jenis ibadah/kegiatan kerohanian (`IBADAH_RUTIN`, `JUMAT_MALAM`, dll). |
| 10 | `public.attendance_schedules` | `id`, `name`, `activity_type_id`, `schedule_kind`, `starts_at`, `ends_at`, `repeat_days`, `start_time`, `end_time`, `status` | Constraint GiST `no_overlapping_active_schedules` mencegah jadwal sekali waktu bertumpuk. |
| 11 | `public.attendance_sessions` | `id`, `schedule_id`, `starts_at`, `ends_at`, `status`, `closed_at` | Constraint GiST `sessions_no_overlap` mencegah sesi terbuka beririsan; trigger audit otomatis mencatat perubahan. |
| 12 | `public.geofence_settings` | `id`, `session_id`, `location_name`, `is_enabled`, `latitude`, `longitude`, `radius_m`, `max_accuracy_m`, `geofence_polygon` | Titik koordinat GPS PostGIS untuk validasi presensi berbasis lokasi. |
| 13 | `public.attendance_records` | `id`, `session_id`, `resident_id`, `resident_nim`, `resident_name`, `status`, `method`, `recorded_by`, `face_match`, `liveness_passed`, `location_valid` | Constraint unik `unique_resident_session` mencegah presensi ganda secara transaksional/konkuren. |
| 14 | `public.attendance_record_history` | `id`, `record_id`, `old_status`, `new_status`, `old_method`, `new_method`, `correction_reason`, `changed_by`, `changed_at` | Tabel histori immutable (trigger `trg_protect_immutable_tables` melarang UPDATE dan DELETE). |
| 15 | `public.attendance_validation_logs` | `id`, `session_id`, `resident_id`, `method`, `result`, `face_score`, `liveness_score`, `rejection_reason`, `attempted_at` | Log validasi AI dan presensi; skor divalidasi pada rentang `[0.0, 1.0]`. |
| 16 | `public.semesters` | `id`, `name`, `academic_year`, `starts_on`, `ends_on`, `is_active` | Data semester aktif untuk akumulasi poin pelanggaran. |
| 17 | `public.violations` | `id`, `resident_id`, `attendance_record_id`, `semester_id`, `points`, `status`, `source`, `reason` | Catatan pelanggaran otomatis (dari ketidakhadiran) maupun manual. |
| 18 | `public.violation_point_history` | `id`, `violation_id`, `old_points`, `new_points`, `old_status`, `new_status`, `changed_by`, `reason` | Histori perubahan poin pelanggaran (immutable). |
| 19 | `public.coaching_records` | `id`, `resident_id`, `semester_id`, `coached_by`, `coaching_date`, `topic`, `notes` | Catatan pembinaan mahasiswa oleh Village Dean. |
| 20 | `public.help_requests` | `id`, `resident_id`, `request_type`, `subject`, `description`, `status`, `handled_by` | Tiket permintaan bantuan mahasiswa & laporan tindak lanjut kampus. |
| 21 | `public.help_request_updates` | `id`, `request_id`, `old_status`, `new_status`, `note`, `updated_by` | Histori penanganan tiket bantuan. |
| 22 | `public.activity_exemptions` | `id`, `title`, `starts_on`, `ends_on`, `residence_category`, `activity_type_id`, `resident_id`, `reason` | Pembebasan kewajiban kegiatan atau hari libur. |
| 23 | `public.audit_logs` | `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `old_data`, `new_data`, `description` | Tabel audit trail sistem (immutable). |
| 24 | `public.biometric_retention_rules`| `id`, `activity_type_id`, `retention_days`, `auto_purge` | Aturan durasi retensi data biometrik (default 90 hari). |
| 25 | `public.system_configurations` | `id`, `config_key`, `config_value`, `description` | Parameter konfigurasi sistem (ambang batas kemiripan, liveness, dll). |
| 26 | `storage.objects` | `id`, `bucket_id`, `name`, `owner`, `metadata` | Bucket `face-enrollments`; dilindungi 4 RLS policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`). |

---

## 3. Fungsi-Fungsi Kritis PostgreSQL (`public`)

| Nama Fungsi | Parameter | Hak Eksekusi & Security | Deskripsi |
|---|---|---|---|
| `public.set_app_context` | `p_user_id uuid, p_claims jsonb` | `SECURITY DEFINER`, `search_path = public, pg_temp` | Menerapkan identitas JWT ke variabel sesi sesi transaksi aktif. |
| `public.get_user_for_login` | `p_identifier text` | `SECURITY DEFINER` | Mencari akun pengguna berdasarkan username, NIM, atau email tanpa membocorkan data pengguna lain. |
| `public.register_resident_account` | `p_nim text, p_full_name text, p_password_hash text, p_email text` | `SECURITY DEFINER` | Mendaftarkan akun login baru dengan validasi NIM resmi berstatus `AKTIF`. |
| `public.register_login_failure` | `p_user_id uuid` | `SECURITY DEFINER` | Menambah counter gagal login; jika mencapai 5 kali, mengunci akun selama 5 menit (`locked_until = now() + interval '5 minutes'`). |
| `public.register_login_success` | `p_user_id uuid` | `SECURITY DEFINER` | Mereset counter gagal login dan mengosongkan `locked_until`. |
| `public.face_similarity` | `p_resident_id uuid, p_embedding vector(512)` | `SECURITY DEFINER` | Menghitung kemiripan kosinus `(1 - (fp.embedding <=> p_embedding))` terhadap profil wajah aktif penghuni. |
| `public.find_similar_faces` | `p_embedding vector(512), p_threshold numeric, p_exclude_resident_id uuid, p_limit int` | `SECURITY DEFINER` | Mencari wajah serupa pada penghuni lain untuk deteksi duplikasi (`S-05`). |
| `public.promote_face_enrollment`| `p_enrollment_id uuid, p_retention_days int` | `SECURITY DEFINER` | Memindahkan `candidate_embedding` ke `face_profiles` secara atomik dan mengarsipkan profil lama ke `face_profile_history`. |
| `public.check_geofence` | `p_session_id uuid, p_lat double precision, p_lon double precision, p_acc double precision` | `SECURITY DEFINER` | Menguji apakah koordinat GPS berada dalam radius meter geofence PostGIS. |
| `public.materialize_sessions` | `p_schedule_id uuid, p_from date, p_to date, p_actor_id uuid` | `SECURITY DEFINER` | Membentuk sesi presensi otomatis dari jadwal berulang. |
| `public.generate_absences` | `p_session_id uuid, p_actor_id uuid` | `SECURITY DEFINER` | Menutup sesi dan mencatat ketidakhadiran serta poin pelanggaran otomatis bagi penghuni yang belum presensi. |
| `public.purge_expired_face_data`| - | `SECURITY DEFINER` | Menghapus arsip biometrik yang telah melewati `retention_until`. |

---

## 4. Keamanan Trigger dan Constraint Database

1. **Trigger Perlindungan Tabel Immutable (`trg_protect_immutable_tables`):**
   Mencegah operasi `UPDATE` dan `DELETE` pada tabel `audit_logs`, `attendance_record_history`, `violation_point_history`, dan `attendance_validation_logs`.
2. **Constraint Anti-Presensi Ganda (`unique_resident_session`):**
   `UNIQUE (session_id, resident_id)` pada `public.attendance_records` memastikan bahwa dalam kondisi balapan transaksi (concurrency race condition), hanya satu presensi yang dapat berhasil disimpan.
3. **Constraint Validasi Skor Biometrik:**
   - `valid_face_score`: `CHECK (face_score IS NULL OR (face_score >= 0 AND face_score <= 1))`
   - `valid_liveness_score`: `CHECK (liveness_score IS NULL OR (liveness_score >= 0 AND liveness_score <= 1))`
   - `photo_quality_range`: `CHECK (quality_score >= 0 AND quality_score <= 1)`
   - `photo_liveness_range`: `CHECK (liveness_score >= 0 AND liveness_score <= 1)`
4. **Constraint Validasi Presensi Manual (`manual_requires_reason`):**
   `CHECK (method <> 'MANUAL' OR (reason IS NOT NULL AND trim(reason) <> ''))` memastikan presensi manual tidak pernah disimpan tanpa alasan tertulis.
