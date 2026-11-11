# DATABASE SCHEMA — ASRAMA PRESENSI (26 TABEL)

## 1. Daftar 12 Tabel Utama (Schema V1 + Perluasan)

| No | Nama Tabel | Fungsi Utama | Kolom Kunci & Tambahan |
|---|---|---|---|
| 1 | `public.residents` | Master daftar penghuni resmi & mahasiswa yang dipantau | `id`, `nim` (UNIQUE), `full_name`, `status` (`AKTIF`/`NONAKTIF`), `residence_category` (`ASRAMA`/`LUAR_DEKAT`/`LUAR_JAUH`), `building`, `room_number` |
| 2 | `public.users` | Akun autentikasi (`PENGHUNI`, `MONITOR`, `ADMIN`, `VILLAGE_DEAN`) | `id`, `resident_id` (UNIQUE FK), `username` (UNIQUE), `email` (UNIQUE nullable), `password_hash`, `role`, `is_active`, `failed_login_attempts`, `locked_until`, `last_login_at` |
| 3 | `public.consent_records` | Bukti persetujuan pengumpulan & pemrosesan data biometrik wajah (`P-05`) | `id`, `resident_id`, `consent_version`, `consented_at`, `revoked_at`, `evidence_path` |
| 4 | `public.face_enrollments` | Sesi pendaftaran/pembaruan wajah kandidat (`P-02`, `P-10`) | `id`, `resident_id`, `status` (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`), `candidate_embedding` (`vector(512)`), `model_version`, `failure_reason`, `superseded_at`, `retention_until`, `consent_id` |
| 5 | `public.enrollment_photos` | Metadata 5 pose foto wajah per pendaftaran (`P-02`..`P-04`) | `id`, `enrollment_id`, `pose` (`LURUS`/`KIRI`/`KANAN`/`ATAS`/`BAWAH`), `bucket_id`, `storage_path`, `quality_score`, `liveness_score`, `quality_passed`, `liveness_passed`, `quality_details`, `rejection_reason` |
| 6 | `public.face_profiles` | Profil embedding wajah aktif penghuni (`S-03`, `K-01`) | `id`, `resident_id` (UNIQUE), `embedding` (`vector(512)` HNSW), `model_version`, `enrolled_at`, `source_enrollment_id` |
| 7 | `public.attendance_schedules` | Jadwal kegiatan sekali waktu (`ONE_TIME`) maupun berulang (`RECURRING`) (`J-06`) | `id`, `name`, `activity_type_id`, `schedule_kind`, `starts_at`, `ends_at`, `repeat_days`, `start_time`, `end_time`, `valid_from`, `valid_to`, `status`, `created_by` |
| 8 | `public.attendance_sessions` | Sesi presensi aktual yang dibuka dari jadwal (`J-06`, `J-07`) | `id`, `schedule_id`, `starts_at`, `ends_at`, `status` (`OPEN`/`CLOSED`/`CANCELLED`), `created_by`, `closed_at` |
| 9 | `public.geofence_settings` | Konfigurasi titik koordinat & radius geofence per sesi (`E`) | `id`, `session_id` (UNIQUE), `location_name`, `is_enabled`, `latitude`, `longitude`, `radius_m`, `max_accuracy_m`, `geom` (`geography(Point,4326)`) |
| 10 | `public.attendance_records` | Catatan kehadiran penghuni per sesi (`P-07`, `P-09`, `J-03`..`J-05`) | `id`, `session_id`, `resident_id`, `resident_nim`, `resident_name`, `status` (`HADIR`/`TIDAK_HADIR`), `method` (`SCAN`/`MANUAL`/`DIBANTU_PENJAGA`), `reason`, `recorded_by`, `face_match`, `liveness_passed`, `latitude`, `longitude`, `accuracy_m`, `distance_m`, `location_valid`, `corrected_by`, `correction_reason`, `corrected_at` |
| 11 | `public.attendance_validation_logs` | Log teknis sistem AI & validasi lokasi setiap percobaan scan (`S-07`, `K-03`) | `id`, `session_id`, `resident_id`, `method`, `result` (`SUCCESS`/`REJECTED`), `face_score`, `liveness_score`, `face_match`, `liveness_passed`, `location_valid`, `distance_m`, `accuracy_m`, `rejection_reason`, `attempted_at` |
| 12 | `public.audit_logs` | Log audit aktivitas penting admin, monitor, dan perubahan data (`S-07`, `K-03`) | `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `old_data`, `new_data`, `description`, `created_at` |

---

## 2. Daftar 14 Tabel Pendukung & Fungsional Tambahan

| No | Nama Tabel | Fungsi Utama |
|---|---|---|
| 13 | `public.semesters` | Periode semester akademik (`name`, `starts_on`, `ends_on`, `is_current`). |
| 14 | `public.activity_types` | Master jenis kegiatan (`IBADAH_RUTIN`, `JUMAT_MALAM`, `SABTU_PAGI`, `SABTU_SORE`, `WOP`, `KHUSUS`). |
| 15 | `public.activity_requirements` | Konfigurasi matriks kewajiban kegiatan per `residence_category` (`ASRAMA`, `LUAR_DEKAT`, `LUAR_JAUH`). |
| 16 | `public.activity_exemptions` | Hari libur atau pembebasan kewajiban kegiatan (umum, per kategori, per kegiatan, atau per penghuni). |
| 17 | `public.attendance_record_history` | Riwayat perubahan/koreksi status presensi (immutable). |
| 18 | `public.face_profile_history` | Arsip profil embedding wajah lama saat re-enrollment dengan batas retensi (`retention_until`). |
| 19 | `public.violation_rules` | Konfigurasi aturan poin pelanggaran ketidakhadiran berdasarkan jenis kegiatan & kategori tempat tinggal. |
| 20 | `public.violations` | Catatan pelanggaran ketidakhadiran (`AUTO`) maupun koreksi/input petugas (`MANUAL`). |
| 21 | `public.violation_point_history` | Riwayat perubahan poin & status pelanggaran (immutable). |
| 22 | `public.semester_evaluations` | Rekap evaluasi kehadiran dan total poin pelanggaran penghuni per semester. |
| 23 | `public.coaching_records` | Catatan riwayat pembinaan penghuni oleh Village Dean / petugas. |
| 24 | `public.emergency_contacts` | Data kontak darurat penghuni (terlindungi RLS ketat). |
| 25 | `public.help_requests` | Permintaan bantuan mahasiswa (`PERMINTAAN_BANTUAN`) & laporan tindak lanjut kampus (`LAPORAN_TINDAK_LANJUT`). |
| 26 | `public.help_request_updates` | Riwayat tindak lanjut dan perubahan status penanganan laporan/bantuan. |
