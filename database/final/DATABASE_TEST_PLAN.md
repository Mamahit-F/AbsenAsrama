# DATABASE TEST PLAN & EXECUTION REPORT — ASRAMA PRESENSI

## 1. Ringkasan Eksekusi Pengujian

Seluruh pengujian telah **dieksekusi secara langsung** pada instance PostgreSQL 17 project Supabase `asrama-presensi` (`tjgttljfdlcwxbregzqs`) menggunakan transaksi terisolasi (`BEGIN ... ROLLBACK`) sehingga membuktikan kebenaran fungsionalitas dan keamanan tanpa meninggalkan data dummy di tabel produksi.

- **Status Pengujian Keseluruhan:** **100% PASSED**
- **Supabase Security Advisor Lints:** **0 Issues (`[]`)**
- **Supabase Performance Advisor Lints (Unindexed FK & Multiple Permissive Policies):** **0 Issues**

---

## 2. Daftar Skenario Pengujian & Hasil Aktual

| Kode Uji | Kategori & Kebutuhan | Skenario Pengujian | Hasil yang Diharapkan | Hasil Aktual | Status |
|---|---|---|---|---|---|
| `SEC-00` | Keamanan Role (`anon` & `authenticated`) | Menjalankan `SET LOCAL ROLE anon` dan `SET LOCAL ROLE authenticated` lalu mencoba membaca `public.face_profiles` dan `public.users`. | Ditolak dengan `42501 insufficient_privilege` karena seluruh grant telah di-`REVOKE`. | Ditolak (`insufficient_privilege`) | **PASS** |
| `SEC-01` | Anti-Spoofing Klaim JWT / Role | Mengatur konteks sebagai `PENGHUNI` lalu memanipulasi `SET LOCAL app.current_user_role = 'ADMIN'` dan memanggil `public.current_app_role()`. | Melempar exception `Security violation: role claim mismatch with database`. | Exception dilempar (`42501`) | **PASS** |
| `SEC-02` | Pencegahan Eskalasi Hak Akses | Sebagai `PENGHUNI` (`ROLE app_backend`), menjalankan `UPDATE public.users SET role = 'ADMIN' WHERE id = current_app_user_id()`. | Ditolak oleh trigger `trg_protect_user_columns`. | Ditolak (`42501`) | **PASS** |
| `SEC-03` | Imutabilitas Audit & Histori (`K-03`, `K-05`) | Mencoba `UPDATE` atau `DELETE` pada `audit_logs`, `attendance_record_history`, `violation_point_history`, `attendance_validation_logs`. | Ditolak oleh hak akses tabel dan trigger `prevent_history_modification()`. | Ditolak (`Tabel riwayat/audit bersifat immutable`) | **PASS** |
| `P-01` | Pendaftaran Akun Penghuni dengan NIM | 1) Daftar dengan NIM tidak terdaftar.<br>2) Daftar dengan NIM resmi aktif.<br>3) Daftar ulang dengan NIM yang sama. | 1) Ditolak `'NIM tidak terdaftar dalam daftar penghuni resmi'`.<br>2) Berhasil membuat akun `PENGHUNI`.<br>3) Ditolak `'NIM sudah memiliki akun'`. | Sesuai ekspektasi pada ketiga kasus | **PASS** |
| `A-01` / `A-04` | Penguncian Akun 5x Gagal Login | Memanggil `register_login_failure()` 5 kali berturut-turut, lalu mencoba `set_app_context()`. | Akun terkunci selama 5 menit pada percobaan ke-5; `set_app_context()` menolak akun terkunci; `register_login_success()` membuka kunci. | Terkunci pada percobaan ke-5 & ditolak saat terkunci | **PASS** |
| `P-02`..`P-06` | Face Enrollment 5 Pose & Consent | 1) Insert foto dengan path tidak sesuai format.<br>2) Set status `COMPLETED` saat baru 4 pose.<br>3) Tambahkan pose ke-5 + consent aktif lalu `COMPLETED`. | 1) Ditolak oleh constraint/trigger path.<br>2) Ditolak `'Enrollment requires exactly 5 valid pose photos'`.<br>3) Berhasil `COMPLETED`. | Sesuai ekspektasi | **PASS** |
| `S-05` | Penolakan Wajah Ganda saat Pendaftaran | Penghuni B mencoba menyelesaikan pendaftaran wajah menggunakan vektor embedding 512-d yang identik/mirip dengan Penghuni A yang aktif. | Ditolak oleh trigger `validate_completed_enrollment()` dengan pesan `'Wajah sudah terdaftar'`. | Ditolak (`Wajah sudah terdaftar`) | **PASS** |
| `P-10` | Pendaftaran Ulang Wajah Aman | Penghuni A melakukan pendaftaran wajah kedua dan memanggil `promote_enrollment()`. | Profil lama diarsipkan ke `face_profile_history`, profil baru aktif di `face_profiles`, `candidate_embedding` dikosongkan. | `face_profile_history` bertambah 1 baris, `face_profiles` terbarui | **PASS** |
| `J-06` | Pencegahan Sesi Presensi Bertumpuk | Membuat sesi baru yang rentang waktunya beririsan (`[starts_at, ends_at)`) dengan sesi aktif lain. | Ditolak oleh exclusion constraint GiST `sessions_no_overlap`. | Ditolak (`conflicting key value violates exclusion constraint`) | **PASS** |
| `J-07` | Validasi Rentang Waktu Scan Aktif | Mencoba insert presensi `SCAN` tepat pada `ends_at` (batas atas setengah terbuka `[starts_at, ends_at)`). | Ditolak oleh trigger `validate_attendance_insert()` dengan pesan `'Tidak ada sesi presensi aktif'`. | Ditolak (`Tidak ada sesi presensi aktif`) | **PASS** |
| `P-07` & `P-09` | Presensi Scan & Pencegahan Duplikasi | 1) Scan pertama di dalam sesi aktif.<br>2) Scan kedua oleh penghuni yang sama pada sesi yang sama. | 1) Berhasil tercatat `HADIR`.<br>2) Ditolak oleh constraint `unique_resident_session`. | Scan pertama sukses, scan kedua ditolak | **PASS** |
| `J-03` | Presensi Manual Wajib Alasan | Mencatat presensi `MANUAL` dengan `reason` kosong atau hanya spasi (`'   '`). | Ditolak oleh check constraint `attendance_reason_required`. | Ditolak | **PASS** |
| `GEO-01` | Validasi Geofence PostGIS | Memanggil `check_geofence()` untuk titik di dalam radius (100m) dan di luar radius. | Mengembalikan `is_valid=true, reason='OK'` di dalam radius, dan `is_valid=false, reason='DI_LUAR_RADIUS'` di luar radius. | Sesuai ekspektasi | **PASS** |
| `RLS-01` | Isolasi Data Antar Penghuni & Role | Sebagai `PENGHUNI 1`, query `residents`, `attendance_records`, `audit_logs`. Sebagai `MONITOR`, query `residents` dan `users`. | `PENGHUNI 1` hanya melihat 1 baris miliknya sendiri dan 0 baris `audit_logs`. `MONITOR` melihat seluruh penghuni tetapi hanya melihat 1 baris miliknya sendiri di `users`. | Terisolasi dengan tepat | **PASS** |
| `VIO-01` | Ketidakhadiran, Pelanggaran Otomatis, & Koreksi | Menjalankan `generate_absences()` pada sesi yang telah berakhir, lalu mengoreksi presensi menjadi `HADIR` dengan `correction_reason`. | Hanya penghuni dengan kategori wajib yang dicatat `TIDAK_HADIR` & mendapat poin `AUTO`; saat dikoreksi ke `HADIR`, riwayat tercatat di `attendance_record_history` dan pelanggaran `AUTO` menjadi `VOID`. | Sesuai ekspektasi | **PASS** |
| `A-03` & `K-05` | Retensi Riwayat Presensi & Penghapusan Penghuni | 1) Mencoba menghapus sesi yang sudah memiliki catatan presensi.<br>2) Menghapus data penghuni dari `residents`. | 1) Ditolak oleh FK `ON DELETE RESTRICT`.<br>2) `face_profiles` terhapus (`CASCADE`), namun `attendance_records` tetap tersimpan (`resident_id = NULL`, snapshot `resident_nim` dan `resident_name` utuh). | Sesuai ekspektasi | **PASS** |
| `STG-01` | Isolasi Supabase Storage (`storage.objects`) | 1) `PENGHUNI 1` unggah ke `{res1_id}/{enr1_id}/front.jpg`.<br>2) `PENGHUNI 1` coba unggah ke folder `PENGHUNI 2`.<br>3) `PENGHUNI 2` coba baca objek `PENGHUNI 1`. | 1) Berhasil.<br>2) Ditolak oleh policy `storage_face_insert`.<br>3) Mengembalikan 0 baris oleh policy `storage_face_select`. | Sesuai ekspektasi | **PASS** |

---

## 3. Cara Menjalankan Ulang Pengujian

Seluruh pengujian di atas dikemas secara mandiri di dalam [`FINAL_DATABASE_VERIFICATION.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/final/FINAL_DATABASE_VERIFICATION.sql) dan dapat dijalankan kapan saja tanpa mengubah state data:

```sql
-- Jalankan seluruh isi file database/final/FINAL_DATABASE_VERIFICATION.sql
```
