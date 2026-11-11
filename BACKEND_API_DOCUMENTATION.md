# BACKEND API DOCUMENTATION — ASRAMA PRESENSI

Dokumentasi lengkap REST API **Asrama Presensi Backend** Universitas Klabat (UNKLAB) (`Spring Boot 3.3.5`, zona waktu `Asia/Makassar` WITA) beserta kontrak integrasi HTTP ke layanan AI **Python FastAPI**.

- **Base URL:** `http://localhost:8080`
- **Swagger UI:** `http://localhost:8080/swagger-ui.html`
- **OpenAPI 3.0 Spec:** `http://localhost:8080/v3/api-docs`

---

## 1. Format Respons Standar

### Respons Sukses (`ApiResponse<T>`)
```json
{
  "success": true,
  "code": "OK",
  "message": "Pesan deskriptif keberhasilan",
  "data": { ... },
  "timestamp": "2026-11-10T14:30:00+08:00"
}
```

### Respons Gagal / Error (`ApiResponse<Void>`)
```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "Pesan kesalahan yang mudah dipahami klien",
  "details": {
    "fieldName": "Pesan validasi spesifik"
  },
  "timestamp": "2026-11-10T14:30:00+08:00"
}
```

---

## 2. Modul Authentication & Session (`/api/v1/auth`)

| Method | Endpoint | Role / Akses | Requirement | Deskripsi |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Publik (Rate-Limited 20 RPM) | `P-01` | Registrasi akun `PENGHUNI` menggunakan NIM resmi yang berstatus `AKTIF` di tabel `public.residents`. |
| `POST` | `/api/v1/auth/login` | Publik (Rate-Limited 20 RPM) | `P-01`, `J-01`, `A-01`, `A-04` | Login seluruh role (`PENGHUNI`, `MONITOR`, `ADMIN`, `VILLAGE_DEAN`). Akun terkunci otomatis selama 5 menit setelah 5x gagal berturut-turut (`423 LOCKED`). |
| `POST` | `/api/v1/auth/refresh` | Publik | `A-01` | Memperbarui pasangan token menggunakan Refresh Token valid (rotasi otomatis). |
| `POST` | `/api/v1/auth/logout` | Terautentikasi | `A-01` | Mencabut JTI Access Token dan Refresh Token secara seketika. |
| `GET` | `/api/v1/auth/me` | Terautentikasi | - | Mendapatkan profil sesi pengguna aktif (`userId`, `username`, `role`, `residentId`). |
| `POST` | `/api/v1/auth/change-password` | Terautentikasi | `K-02` | Mengganti password sendiri dan mencabut seluruh token aktif pengguna. |

---

## 3. Modul Resident & Consent Management (`/api/v1/residents`)

| Method | Endpoint | Role / Akses | Deskripsi |
|---|---|---|---|
| `GET` | `/api/v1/residents/me` | `PENGHUNI` | Profil penghuni milik pengguna yang sedang login (termasuk status biometrik wajah). |
| `GET` | `/api/v1/residents` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Daftar seluruh penghuni dengan filter `status`, `category`, pencarian `search`, serta paginasi `limit` dan `offset`. |
| `GET` | `/api/v1/residents/{residentId}` | Pemilik Data / Staff | Detail profil penghuni berdasarkan ID (dilindungi verifikasi kepemilikan data & RLS). |
| `POST` | `/api/v1/residents/{residentId}/consents` | `PENGHUNI` (milik sendiri), `ADMIN` | Memberikan persetujuan pemrosesan data biometrik wajah (`P-05`). |
| `GET` | `/api/v1/residents/{residentId}/consents` | Pemilik Data / Staff | Riwayat persetujuan data biometrik wajah penghuni. |
| `POST` | `/api/v1/residents/{residentId}/consents/revoke` | `PENGHUNI` (milik sendiri), `ADMIN` | Mencabut persetujuan biometrik aktif. |
| `GET` | `/api/v1/residents/{residentId}/emergency-contacts` | Pemilik Data / Staff | Daftar kontak darurat penghuni. |
| `POST` | `/api/v1/residents/{residentId}/emergency-contacts` | `PENGHUNI` (milik sendiri), `ADMIN`, `VILLAGE_DEAN` | Menambahkan kontak darurat baru. |

---

## 4. Modul Face Enrollment (`/api/v1/enrollments`)

> **Jaminan Keamanan Biometrik (`K-01`):** Tidak ada satu pun DTO pada modul ini yang pernah mengembalikan vektor embedding (`vector(512)`) ke frontend.

| Method | Endpoint | Role / Akses | Deskripsi |
|---|---|---|---|
| `POST` | `/api/v1/enrollments/start` | `PENGHUNI`, `ADMIN` | Memulai sesi pendaftaran wajah (wajib memiliki consent biometrik aktif `P-05`). |
| `POST` | `/api/v1/enrollments/{enrollmentId}/poses/{pose}` | `PENGHUNI`, `ADMIN` | `multipart/form-data`: Mengunggah satu pose wajah (`LURUS`, `KIRI`, `KANAN`, `ATAS`, `BAWAH`). Mendukung retry per pose yang gagal (`P-04`). |
| `POST` | `/api/v1/enrollments/{enrollmentId}/complete` | `PENGHUNI`, `ADMIN` | Memvalidasi 5 pose lengkap, ekstraksi embedding gabungan melalui AI, penolakan wajah ganda (`S-05`: `409 CONFLICT`), dan promosi atomik ke profil aktif (`P-10`). |
| `GET` | `/api/v1/enrollments/{enrollmentId}` | Pemilik Data / Staff | Status sesi enrollment dan kelulusan 5 pose. |
| `GET` | `/api/v1/enrollments/residents/{residentId}/active-profile` | Pemilik Data / Staff | Metadata profil wajah aktif (versi model, tanggal daftar, tanpa vektor embedding). |

---

## 5. Modul Schedule, Session & Geofence (`/api/v1/schedules`)

| Method | Endpoint | Role / Akses | Deskripsi |
|---|---|---|---|
| `GET` | `/api/v1/schedules/activity-types` | Semua Role | Master jenis kegiatan kerohanian (`IBADAH_RUTIN`, `JUMAT_MALAM`, dll). |
| `GET` | `/api/v1/schedules` | Semua Role | Daftar jadwal kegiatan (sekali waktu maupun berulang). |
| `GET` | `/api/v1/schedules/{scheduleId}` | Semua Role | Detail jadwal kegiatan berdasarkan ID. |
| `GET` | `/api/v1/schedules/{scheduleId}/history` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Riwayat audit perubahan jadwal dari tabel `public.audit_logs`. |
| `POST` | `/api/v1/schedules` | `ADMIN`, `MONITOR` | Membuat jadwal baru dengan validasi jam selesai > jam mulai (`J-06`). |
| `PUT` | `/api/v1/schedules/{scheduleId}` | `ADMIN`, `MONITOR` | Memperbarui jadwal kegiatan (tercatat otomatis di audit log). |
| `POST` | `/api/v1/schedules/{scheduleId}/materialize` | `ADMIN`, `MONITOR` | Membentuk sesi presensi otomatis untuk rentang tanggal tertentu (`public.materialize_sessions`). |
| `GET` | `/api/v1/schedules/sessions` | Semua Role | Daftar sesi presensi dengan filter `status` dan `scheduleId`. |
| `GET` | `/api/v1/schedules/sessions/active` | Semua Role | Mendapatkan sesi presensi yang sedang aktif saat ini (`J-07`). |
| `POST` | `/api/v1/schedules/sessions` | `ADMIN`, `MONITOR` | Membuka sesi presensi baru (dilindungi constraint anti-bertumpuk GiST). |
| `PUT` | `/api/v1/schedules/sessions/{sessionId}/geofence` | `ADMIN`, `MONITOR` | Mengatur koordinat GPS dan radius meter geofence PostGIS. |
| `POST` | `/api/v1/schedules/sessions/{sessionId}/close` | `ADMIN`, `MONITOR` | Menutup sesi presensi dan menjalankan kalkulasi ketidakhadiran otomatis (`public.generate_absences`). |
| `DELETE` | `/api/v1/schedules/sessions/{sessionId}` | `ADMIN`, `MONITOR` | Menghapus sesi. Ditolak (`409 CONFLICT`) apabila sesi sudah memiliki riwayat presensi (`K-05`). |
| `GET` / `POST` | `/api/v1/schedules/exemptions` | Semua Role / Staff | Daftar & penambahan izin pembebasan kegiatan atau hari libur. |

---

## 6. Modul Attendance Management (`/api/v1/attendance`)

| Method | Endpoint | Role / Akses | Deskripsi |
|---|---|---|---|
| `POST` | `/api/v1/attendance/scan` | `PENGHUNI` | `multipart/form-data`: Scan wajah mandiri. Memvalidasi liveness terlebih dahulu (`S-06`), kecocokan wajah (`face_similarity`), geofence, dan idempotensi (`P-09`). |
| `POST` | `/api/v1/attendance/scan/guard-assisted` | `MONITOR`, `ADMIN` | `multipart/form-data`: Scan bantuan penjaga. Wajib memverifikasi wajah cocok dengan `residentId` yang dipilih penjaga (`J-05`). |
| `POST` | `/api/v1/attendance/manual` | `MONITOR`, `ADMIN` | Presensi manual dengan alasan wajib diisi (`J-03`, `J-04`). |
| `PATCH` | `/api/v1/attendance/{recordId}/correct` | `MONITOR`, `ADMIN`, `VILLAGE_DEAN` | Mengoreksi status presensi dengan alasan koreksi wajib. Menulis ke tabel histori immutable (`K-03`). |
| `GET` | `/api/v1/attendance/sessions/{sessionId}/recap` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Rekapitulasi hadir, tidak hadir, belum presensi, dan rincian per metode (`J-02`). |
| `GET` | `/api/v1/attendance/me` | `PENGHUNI` | Riwayat kehadiran milik penghuni yang sedang login (dengan paginasi `limit` & `offset`). |
| `GET` | `/api/v1/attendance/residents/{residentId}` | Pemilik Data / Staff | Riwayat kehadiran penghuni berdasarkan ID (dengan paginasi `limit` & `offset`). |
| `GET` | `/api/v1/attendance/dashboard` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Statistik ringkas dashboard kehadiran. |
| `GET` | `/api/v1/attendance/ai-status` | Publik | Mengecek ketersediaan dan status kesehatan layanan AI FastAPI pengenalan wajah. |

---

## 7. Modul Admin Management (`/api/v1/admin`)

Seluruh endpoint di bawah ini diproteksi khusus untuk role `ADMIN`:

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/v1/admin/residents` | Menambahkan penghuni baru ke daftar penghuni resmi (`A-02`). |
| `PUT` | `/api/v1/admin/residents/{residentId}` | Mengubah data profil penghuni resmi. |
| `PATCH` | `/api/v1/admin/residents/{residentId}/status` | Mengaktifkan atau menonaktifkan status penghuni (`AKTIF` / `NONAKTIF`). |
| `DELETE` | `/api/v1/admin/residents/{residentId}` | Menghapus penghuni sesuai aturan retensi (`A-03`, `K-05`): data biometrik dihapus, riwayat presensi dipertahankan (`SET NULL` dengan snapshot NIM/nama). |
| `POST` | `/api/v1/admin/residents/import-csv` | Import CSV penghuni resmi dengan validasi per baris (`A-02`). |
| `POST` | `/api/v1/admin/retention/purge-biometrics` | Membersihkan histori data biometrik yang telah melewati masa retensi (`retention_until`). |
| `GET` | `/api/v1/admin/users` | Daftar seluruh akun pengguna dengan filter role, pencarian `search`, dan paginasi `limit` & `offset`. |
| `POST` | `/api/v1/admin/users` | Membuat akun petugas baru (`MONITOR`, `VILLAGE_DEAN`, `ADMIN`) (`A-04`). |
| `PATCH` | `/api/v1/admin/users/{userId}/active` | Mengaktifkan/menonaktifkan akun pengguna dan mencabut seluruh token aktif pengguna seketika. |
| `POST` | `/api/v1/admin/users/{userId}/reset-password` | Mereset password akun pengguna dan mencabut token lama (`A-04`). |

---

## 8. Modul Violations, Coaching & Help Requests (`/api/v1`)

| Method | Endpoint | Role / Akses | Deskripsi |
|---|---|---|---|
| `GET` | `/api/v1/violations` | Semua Role (Terfilter RLS) | Daftar catatan pelanggaran dan poin ketidakhadiran (dengan paginasi `limit` & `offset`). |
| `POST` | `/api/v1/violations` | `ADMIN`, `VILLAGE_DEAN`, `MONITOR` | Mencatat pelanggaran manual dengan alasan wajib. |
| `PATCH` | `/api/v1/violations/{violationId}` | `ADMIN`, `VILLAGE_DEAN`, `MONITOR` | Mengubah poin atau status pelanggaran dengan alasan wajib (tercatat di `violation_point_history`). |
| `GET` | `/api/v1/violations/{violationId}/history` | Pemilik Data / Staff | Riwayat perubahan poin dan status pelanggaran. |
| `GET` | `/api/v1/coaching` | Semua Role | Riwayat catatan pembinaan penghuni oleh Village Dean (dengan paginasi `limit` & `offset`). |
| `POST` | `/api/v1/coaching` | `ADMIN`, `VILLAGE_DEAN` | Menambahkan catatan pembinaan penghuni. |
| `GET` | `/api/v1/help-requests` | Semua Role (Terfilter RLS) | Daftar tiket bantuan & tindak lanjut (dengan paginasi `limit` & `offset`). |
| `POST` | `/api/v1/help-requests` | Semua Role | Mengajukan tiket bantuan (`PENGHUNI`) atau laporan tindak lanjut (`MONITOR`/`VILLAGE_DEAN`/`ADMIN`). |
| `PATCH` | `/api/v1/help-requests/{requestId}/status` | `ADMIN`, `VILLAGE_DEAN`, `MONITOR` | Memperbarui status penanganan tiket bantuan beserta catatan histori. |
| `GET` | `/api/v1/help-requests/{requestId}/history` | Pemilik Data / Staff | Riwayat penanganan status tiket bantuan. |

---

## 9. Modul Reports & Logs (`/api/v1/reports`)

| Method | Endpoint | Role / Akses | Deskripsi |
|---|---|---|---|
| `GET` | `/api/v1/reports/attendance` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Laporan rekap presensi per periode, sesi, dan status. |
| `GET` | `/api/v1/reports/attendance/export-csv` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Mengunduh file CSV rekap presensi dalam zona waktu WITA dengan proteksi sanitasi *CSV Formula Injection*. |
| `GET` | `/api/v1/reports/logs/audit` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Audit logs aktivitas sistem tanpa password/JWT/embedding (dengan paginasi `limit` & `offset`). |
| `GET` | `/api/v1/reports/logs/validation` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Log validasi AI & presensi (skor wajah, liveness, alasan tolak, dengan paginasi `limit` & `offset`). |
| `GET` | `/api/v1/reports/logs/attendance-history` | `ADMIN`, `MONITOR`, `VILLAGE_DEAN` | Riwayat koreksi presensi dari tabel immutable `attendance_record_history`. |
