# DATABASE RELATIONSHIPS & INTEGRITY RULES

## 1. Aturan Foreign Key & Referential Actions

| Tabel Anak | Kolom FK | Tabel Induk | `ON DELETE` | Alasan Arsitektural |
|---|---|---|---|---|
| `users` | `resident_id` | `residents(id)` | `CASCADE` | Jika data penghuni dihapus, akun login penghuni ikut terhapus (`A-03`). |
| `consent_records` | `resident_id` | `residents(id)` | `CASCADE` | Persetujuan biometrik melekat pada identitas penghuni. |
| `face_enrollments` | `resident_id` | `residents(id)` | `CASCADE` | Menghapus kandidat pendaftaran wajah saat penghuni dihapus (`A-03`). |
| `face_enrollments` | `consent_id` | `consent_records(id)` | `SET NULL` | Menjaga jejak enrollment jika record consent diperbarui. |
| `enrollment_photos` | `enrollment_id` | `face_enrollments(id)` | `CASCADE` | Foto pose dihapus bersama sesi enrollment-nya. |
| `face_profiles` | `resident_id` | `residents(id)` | `CASCADE` | Menghapus embedding wajah aktif saat penghuni dihapus (`A-03`). |
| `face_profiles` | `source_enrollment_id` | `face_enrollments(id)` | `SET NULL` | Profil tetap valid meski log enrollment lama dibersihkan. |
| `face_profile_history` | `resident_id` | `residents(id)` | `CASCADE` | Menghapus histori biometrik saat penghuni dihapus (`A-03`). |
| `attendance_schedules` | `activity_type_id` | `activity_types(id)` | `SET NULL` | Jadwal tetap tersimpan bila tipe kegiatan dinonaktifkan. |
| `attendance_sessions` | `schedule_id` | `attendance_schedules(id)` | `RESTRICT` | Jadwal yang sudah memiliki sesi tidak boleh dihapus paksa. |
| `geofence_settings` | `session_id` | `attendance_sessions(id)` | `RESTRICT` | Pengaturan geofence terjaga selama sesi ada. |
| `attendance_records` | `session_id` | `attendance_sessions(id)` | `RESTRICT` | **K-05:** Sesi yang sudah memiliki catatan presensi tidak dapat dihapus permanen. |
| `attendance_records` | `resident_id` | `residents(id)` | `SET NULL` | **A-03:** Riwayat presensi tetap dipertahankan (`resident_nim` & `resident_name` tersimpan sebagai snapshot) saat penghuni dihapus. |
| `attendance_records` | `recorded_by`, `corrected_by` | `users(id)` | `SET NULL` | Riwayat presensi tetap utuh walaupun akun petugas dihapus. |
| `attendance_record_history` | `record_id` | `attendance_records(id)` | `CASCADE` | Mengikuti siklus hidup `attendance_records` (yang tidak memiliki izin `DELETE`). |
| `violations` | `resident_id` | `residents(id)` | `SET NULL` | Menyimpan snapshot `resident_nim` dan `resident_name` agar riwayat pelanggaran tetap terjaga. |
| `violations` | `attendance_record_id` | `attendance_records(id)` | `SET NULL` | Menjaga catatan pelanggaran. |
| `semester_evaluations` | `semester_id` | `semesters(id)` | `RESTRICT` | Semester yang sudah dievaluasi tidak boleh dihapus. |
| `emergency_contacts`, `help_requests`, `coaching_records` | `resident_id` | `residents(id)` | `CASCADE` | Data personal penghuni ikut dibersihkan bila penghuni dihapus. |
| `help_request_updates` | `request_id` | `help_requests(id)` | `CASCADE` | Riwayat status terikat pada tiket bantuan/tindak lanjut. |
