# Catatan Integrasi Frontend — Asrama Presensi UNKLAB

Dokumen ini mencatat pemetaan kontrak REST API antara frontend React (`frontend/`) dan backend Spring Boot 3.3.5 (`backend/`), keputusan adaptasi model data, pemetaan peran pengguna, serta daftar penyesuaian komponen prototipe menjadi aplikasi siap produksi.

---

## 1. Status Pemeriksaan Backend & Lingkungan (Tahap 0)

1. **Verifikasi Server & OpenAPI (`/v3/api-docs` & `/api/v1/attendance/ai-status`)**:
   - Backend Spring Boot (`asrama-presensi-backend-1.0.0.jar`) berjalan di `http://localhost:8080`.
   - `GET /api/v1/attendance/ai-status` mengembalikan HTTP 200 dengan amplop standar `ApiResponse`:
     ```json
     {
       "success": true,
       "code": "OK",
       "message": "Status layanan AI",
       "data": {
         "service": "FastAPI DeepFace/ArcFace AI Service",
         "healthy": false,
         "status": "UNREACHABLE",
         "available": false
       },
       "timestamp": "2026-11-10T23:18:30.6928505+08:00"
     }
     ```
   - `GET /v3/api-docs` dan `/swagger-ui.html` aktif dan menyajikan spesifikasi OpenAPI 3.0 lengkap.
2. **Proxy Pengembangan (`vite.config.ts`)**:
   - Vite dev server meneruskan seluruh request `/api/v1/*` ke `http://localhost:8080` (`changeOrigin: true`).
   - Variabel lingkungan `VITE_API_BASE_URL` (default `/api/v1`) dikonfigurasi pada `frontend/.env.example`.
3. **Catatan Koneksi Database untuk Pengujian End-to-End Langsung**:
   - Endpoint yang membuka transaksi PostgreSQL memerlukan variabel lingkungan `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, dan `SPRING_DATASOURCE_PASSWORD` yang valid pada proses Spring Boot.

---

## 2. Amplop Respons Standar & Format Error

Sumber kebenaran: `id.ac.unklab.asrama.common.ApiResponse` dan `GlobalExceptionHandler`.

### Amplop JSON (`ApiResponse<T>`)
```ts
export interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
  metadata?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null; // alias kompatibilitas
  timestamp: string; // ISO-8601 dengan offset +08:00 (Asia/Makassar)
}
```
> **Catatan Penting:** Kelas record Java `ApiResponse<T>` menyerialisasi peta detail error (`BusinessException.getDetails()` dan error validasi field `MethodArgumentNotValidException`) ke properti JSON bernama **`metadata`**. Lapisan `ApiError` di `frontend/src/api/client.ts` menormalisasi baik `metadata` maupun `details` ke dalam `error.details` agar komponen form dapat membaca error per-field maupun `lockedUntil` secara konsisten.

### Kode Status HTTP & Error Utama
| Status | `code` | Kondisi & Penanganan di Frontend |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Validasi input gagal; `metadata`/`details` berisi `{ [field]: pesan }`. Dipetakan ke pesan error per input form. |
| `400` | `NO_ACTIVE_SESSION` | Tidak ada sesi presensi yang sedang buka (`OPEN`) pada jam WITA saat ini. Ditangani sebagai state kosong (`null`), bukan crash. |
| `400` | `LIVENESS_FAILED`, `FACE_MISMATCH`, `OUTSIDE_GEOFENCE`, `LOCATION_REQUIRED`, `INCOMPLETE_POSES` | Penolakan bisnis saat scan/enrollment; ditampilkan pada kartu hasil dengan alasan asli dari backend. |
| `401` | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN` | Kredensial salah saat login, atau token kedaluwarsa. Untuk request terautentikasi, `client.ts` otomatis mencoba `POST /api/v1/auth/refresh` satu kali (single-flight). Jika tetap gagal, sesi dibersihkan dan diarahkan ke `/masuk`. |
| `403` | `FORBIDDEN`, `ACCOUNT_INACTIVE`, `RESIDENT_INACTIVE`, `DB_ACCESS_DENIED` | Akses ditolak oleh role atau RLS. Menampilkan halaman/pesan "Akses ditolak". |
| `404` | ` *_NOT_FOUND`, `FACE_PROFILE_NOT_FOUND` | Data tidak ditemukan. Untuk `FACE_PROFILE_NOT_FOUND` pada `/enrollments/status`, dipetakan menjadi status wajah `"Belum Terdaftar"`. |
| `409` | `ALREADY_ATTENDED`, `DUPLICATE_FACE`, `NIM_ALREADY_EXISTS`, `SCHEDULE_OVERLAP`, `SESSION_HAS_ATTENDANCE_RECORDS`, `REFERENTIAL_INTEGRITY` | Konflik data / duplikasi presensi (P-09) / wajah ganda (S-05) / jadwal bertumpuk (J-06) / sesi berpresensi tidak boleh dihapus (K-05). |
| `413` | `FILE_TOO_LARGE` | Ukuran unggahan foto melebihi 5 MB. |
| `423` | `ACCOUNT_LOCKED` | Akun terkunci 5 menit setelah 5x gagal sandi (A-04). `metadata.lockedUntil` berisi timestamp ISO-8601 batas waktu kunci dari server. |
| `429` | `RATE_LIMIT_EXCEEDED` | Terlalu banyak percobaan; menampilkan pesan tunggu beberapa saat. |
| `503` | `AI_SERVICE_UNAVAILABLE` | Layanan FastAPI AI tidak dapat dihubungi; menampilkan banner peringatan dan tombol ajukan permintaan bantuan (`/api/v1/help-requests`). |

---

## 3. Pemetaan Endpoint REST API (`/api/v1`)

### 3.1 Autentikasi (`/api/v1/auth`) — `src/api/auth.ts`
- `POST /api/v1/auth/register` — Body: `{ nim, fullName, password, email? }` -> `ApiResponse<UserSessionDto>`
- `POST /api/v1/auth/login` — Body: `{ identifier, password }` -> `ApiResponse<AuthTokenResponse>` (`accessToken`, `refreshToken`, `tokenType`, `expiresInSeconds`, `user`)
- `POST /api/v1/auth/refresh` — Body: `{ refreshToken }` -> `ApiResponse<AuthTokenResponse>`
- `POST /api/v1/auth/logout` — Body: `{ refreshToken? }` -> `ApiResponse<void>`
- `GET /api/v1/auth/me` — Header `Authorization: Bearer` -> `ApiResponse<UserSessionDto>`
- `POST /api/v1/auth/change-password` — Body: `{ currentPassword, newPassword }` -> `ApiResponse<void>`

### 3.2 Penghuni & Persetujuan Biometrik (`/api/v1/residents`) — `src/api/residents.ts`
- `GET /api/v1/residents/me` (`PENGHUNI`) -> `ApiResponse<ResidentProfileDto>`
- `GET /api/v1/residents` (`ADMIN`, `MONITOR`, `VILLAGE_DEAN`) — Query: `status?`, `category?`, `search?`, `limit?`, `offset?` -> `ApiResponse<ResidentProfileDto[]>`
- `GET /api/v1/residents/{residentId}` -> `ApiResponse<ResidentProfileDto>`
- `GET /api/v1/residents/{residentId}/consents` -> `ApiResponse<ConsentDto[]>`
- `POST /api/v1/residents/{residentId}/consents` — Body: `{ consentVersion, evidencePath? }` -> `ApiResponse<ConsentDto>`
- `POST /api/v1/residents/{residentId}/consents/revoke` -> `ApiResponse<void>`
- `GET /api/v1/residents/{residentId}/emergency-contacts` -> `ApiResponse<EmergencyContactDto[]>`
- `POST /api/v1/residents/{residentId}/emergency-contacts` — Body: `{ fullName, relationship, phone, isPrimary }` -> `ApiResponse<EmergencyContactDto>`

### 3.3 Pendaftaran Wajah 5 Pose (`/api/v1/enrollments`) — `src/api/enrollment.ts`
- `GET /api/v1/enrollments/consent` (`PENGHUNI`) -> `ApiResponse<ConsentDto[]>`
- `POST /api/v1/enrollments/consent` (`PENGHUNI`) — Body: `{ consentVersion, evidencePath? }` -> `ApiResponse<ConsentDto>`
- `GET /api/v1/enrollments/status` (`PENGHUNI`) -> `ApiResponse<ActiveFaceProfileMetadataDto>`
- `GET /api/v1/enrollments/residents/{residentId}/active-profile` -> `ApiResponse<ActiveFaceProfileMetadataDto>`
- `POST /api/v1/enrollments/start` — Body: `{ residentId?, consentId? }` -> `ApiResponse<EnrollmentDetailDto>`
- `POST /api/v1/enrollments/{enrollmentId}/poses/{pose}` (`multipart/form-data`, field `file`, `pose` in `LURUS | KIRI | KANAN | ATAS | BAWAH`) -> `ApiResponse<PoseUploadResponse>`
- `POST /api/v1/enrollments/{enrollmentId}/complete` -> `ApiResponse<CompleteEnrollmentResponse>`
- `GET /api/v1/enrollments/{enrollmentId}` -> `ApiResponse<EnrollmentDetailDto>`

### 3.4 Jadwal, Sesi Presensi & Geofence (`/api/v1/schedules`) — `src/api/schedules.ts`
- `GET /api/v1/schedules/activity-types` -> `ApiResponse<ActivityTypeDto[]>`
- `GET /api/v1/schedules` — Query: `status?` -> `ApiResponse<ScheduleDto[]>`
- `GET /api/v1/schedules/{scheduleId}` -> `ApiResponse<ScheduleDto>`
- `GET /api/v1/schedules/{scheduleId}/history` -> `ApiResponse<ScheduleHistoryEntryDto[]>`
- `POST /api/v1/schedules` — Body: `CreateScheduleRequest` -> `ApiResponse<ScheduleDto>`
- `PUT /api/v1/schedules/{scheduleId}` — Body: `UpdateScheduleRequest` -> `ApiResponse<ScheduleDto>`
- `POST /api/v1/schedules/{scheduleId}/materialize` — Body: `{ fromDate, toDate }` -> `ApiResponse<{ scheduleId, fromDate, toDate, createdSessionsCount }>`
- `GET /api/v1/schedules/sessions` — Query: `status?`, `scheduleId?` -> `ApiResponse<SessionDto[]>`
- `GET /api/v1/schedules/sessions/active` -> `ApiResponse<SessionDto>` (mengembalikan `null` di client bila `NO_ACTIVE_SESSION`)
- `POST /api/v1/schedules/sessions` — Body: `{ scheduleId, startsAt, endsAt }` -> `ApiResponse<SessionDto>`
- `PUT /api/v1/schedules/sessions/{sessionId}/geofence` — Body: `GeofenceConfigRequest` -> `ApiResponse<GeofenceDto>`
- `POST /api/v1/schedules/sessions/{sessionId}/close` -> `ApiResponse<{ sessionId, status, generatedAbsencesCount }>`
- `DELETE /api/v1/schedules/sessions/{sessionId}` -> `ApiResponse<void>` (HTTP 409 `SESSION_HAS_ATTENDANCE_RECORDS` jika sesi memiliki riwayat presensi sesuai K-05)
- `GET /api/v1/schedules/exemptions` & `POST /api/v1/schedules/exemptions` -> `ApiResponse<ExemptionDto>`

### 3.5 Presensi & Dashboard (`/api/v1/attendance`) — `src/api/attendance.ts`
- `GET /api/v1/attendance/ai-status` -> `ApiResponse<{ available: boolean; healthy: boolean; service: string; status: string }>`
- `POST /api/v1/attendance/scan` (`PENGHUNI`, `multipart/form-data`: `file`, `sessionId?`, `latitude?`, `longitude?`, `accuracyM?`, Header `Idempotency-Key`) -> `ApiResponse<AttendanceScanResultResponse>`
- `POST /api/v1/attendance/scan/guard-assisted` (`MONITOR`, `ADMIN`, `multipart/form-data`: `file`, `residentId`, `sessionId?`, `reason?`, `latitude?`, `longitude?`, `accuracyM?`, Header `Idempotency-Key`) -> `ApiResponse<AttendanceScanResultResponse>`
- `POST /api/v1/attendance/manual` (`MONITOR`, `ADMIN`) — Body: `{ sessionId, residentId, status: "HADIR" | "TIDAK_HADIR", reason }` -> `ApiResponse<AttendanceRecordDto>`
- `PATCH /api/v1/attendance/{recordId}/correct` (`MONITOR`, `ADMIN`, `VILLAGE_DEAN`) — Body: `{ status, correctionReason }` -> `ApiResponse<AttendanceRecordDto>`
- `GET /api/v1/attendance/sessions/{sessionId}/recap` (`ADMIN`, `MONITOR`, `VILLAGE_DEAN`) -> `ApiResponse<SessionRecapDto>`
- `GET /api/v1/attendance/me` (`PENGHUNI`) — Query: `from?`, `to?`, `limit?`, `offset?` -> `ApiResponse<AttendanceRecordDto[]>`
- `GET /api/v1/attendance/residents/{residentId}` — Query: `from?`, `to?`, `limit?`, `offset?` -> `ApiResponse<AttendanceRecordDto[]>`
- `GET /api/v1/attendance/dashboard` (`ADMIN`, `MONITOR`, `VILLAGE_DEAN`) -> `ApiResponse<DashboardStatsDto>`

### 3.6 Administrasi (`/api/v1/admin`) — `src/api/admin.ts`
- `POST /api/v1/admin/residents` — Body: `{ nim, fullName, status?, residenceCategory?, building?, roomNumber? }` -> `ApiResponse<ResidentProfileDto>`
- `PUT /api/v1/admin/residents/{residentId}` — Body: `{ nim, fullName, status, residenceCategory, building?, roomNumber? }` -> `ApiResponse<ResidentProfileDto>`
- `PATCH /api/v1/admin/residents/{residentId}/status` — Body: `{ status: "AKTIF" | "NONAKTIF" }` -> `ApiResponse<ResidentProfileDto>`
- `DELETE /api/v1/admin/residents/{residentId}` -> `ApiResponse<void>`
- `POST /api/v1/admin/residents/import-csv` (`multipart/form-data`, field `file`) -> `ApiResponse<CsvImportSummaryDto>`
- `POST /api/v1/admin/retention/purge-biometrics` -> `ApiResponse<{ purgedCount: number }>`
- `GET /api/v1/admin/users` — Query: `role?`, `search?`, `limit?`, `offset?` -> `ApiResponse<UserAccountDto[]>`
- `POST /api/v1/admin/users` — Body: `{ username, email?, password, role }` -> `ApiResponse<UserAccountDto>`
- `PATCH /api/v1/admin/users/{userId}/active` — Body: `{ isActive: boolean }` -> `ApiResponse<UserAccountDto>`
- `PATCH /api/v1/admin/users/{userId}/role` — Body: `{ role }` -> `ApiResponse<UserAccountDto>`
- `POST /api/v1/admin/users/{userId}/reset-password` — Body: `{ newPassword }` -> `ApiResponse<void>`

### 3.7 Laporan, Ekspor CSV & Log (`/api/v1/reports`) — `src/api/reports.ts`
- `GET /api/v1/reports/attendance` — Query: `from?`, `to?`, `sessionId?`, `status?` -> `ApiResponse<PeriodRecapReportDto>`
- `GET /api/v1/reports/attendance/export-csv` — Query: `from?`, `to?`, `sessionId?`, `status?` -> `Blob` (`text/csv; charset=UTF-8`)
- `GET /api/v1/reports/logs/audit` — Query: `entityType?`, `limit?`, `offset?` -> `ApiResponse<AuditLogDto[]>`
- `GET /api/v1/reports/logs/validation` — Query: `sessionId?`, `result?`, `limit?`, `offset?` -> `ApiResponse<ValidationLogDto[]>`
- `GET /api/v1/reports/logs/attendance-history` — Query: `recordId?`, `limit?`, `offset?` -> `ApiResponse<AttendanceRecordHistoryDto[]>`

### 3.8 Permintaan Bantuan & Pelanggaran (`/api/v1/help-requests`, `/api/v1/violations`) — `src/api/helpRequests.ts`
- `GET /api/v1/help-requests` — Query: `status?`, `limit?`, `offset?` -> `ApiResponse<HelpRequestDto[]>`
- `POST /api/v1/help-requests` — Body: `{ residentId?, requestType: "PERMINTAAN_BANTUAN" | "LAPORAN_TINDAK_LANJUT", subject, description }` -> `ApiResponse<HelpRequestDto>`
- `PATCH /api/v1/help-requests/{requestId}/status` — Body: `{ status: "BARU" | "DIPROSES" | "SELESAI" | "DITUTUP", note? }` -> `ApiResponse<HelpRequestDto>`
- `GET /api/v1/help-requests/{requestId}/history` -> `ApiResponse<HelpRequestUpdateHistoryDto[]>`

---

## 4. Pemetaan Peran Pengguna (Role Mapping)

| Role Backend (`UserRole`) | Peran UI (`Role`) | Rute Utama | Catatan Hak Akses |
|---|---|---|---|
| `PENGHUNI` | `penghuni` | `/penghuni` | Hanya mengakses data miliknya sendiri (`/residents/me`, `/attendance/me`, `/enrollments/*`, `/attendance/scan`, `/help-requests`). |
| `MONITOR` | `penjaga` | `/penjaga` | Mengelola presensi sesi aktif, bantu scan (`guard-assisted`), presensi manual, jadwal & sesi presensi, serta ekspor rekap CSV. |
| `VILLAGE_DEAN` | `penjaga` | `/penjaga` | Diarahkan ke antarmuka `/penjaga` (dashboard, kehadiran/roster, rekap CSV). Endpoint khusus `MONITOR`/`ADMIN` seperti buat sesi atau bantu scan dinonaktifkan/menampilkan keterangan izin sesuai `@PreAuthorize` backend. |
| `ADMIN` | `admin` | `/admin` | Akses penuh ke manajemen penghuni resmi, impor CSV, akun petugas/penjaga, log audit & validasi AI, serta laporan. |

---

## 5. Adaptasi Model Jadwal (`ScheduleDto`) vs Sesi (`SessionDto`)

Pada prototipe awal, jadwal dan sesi digabung menjadi satu objek `Session`. Pada backend produksi:
1. **`ScheduleDto` (`/api/v1/schedules`)** merepresentasikan aturan jadwal (`ONE_TIME` atau `RECURRING` dengan `repeatDays` 1=Senin..7=Minggu, `startTime`, `endTime`, `validFrom`, `validTo`).
   - Konversi hari berulang di frontend: UI menggunakan indeks `0=Minggu .. 6=Sabtu` (`DAY_LABEL`), sedangkan backend menggunakan ISO-8601 `1=Senin .. 7=Minggu`. Fungsi konversi dua arah (`uiDayToIso` / `isoDayToUi`) diterapkan di `ScheduleForm.tsx` dan `Schedules.tsx`.
2. **`SessionDto` (`/api/v1/schedules/sessions`)** merepresentasikan sesi presensi aktual pada tanggal tertentu (`OPEN`, `CLOSED`, `CANCELLED`).
3. Saat penjaga menyimpan jadwal baru di `ScheduleForm.tsx`:
   - Frontend memanggil `POST /api/v1/schedules` (atau `PUT /api/v1/schedules/{id}` saat ubah).
   - Untuk jadwal baru, frontend otomatis memanggil `POST /api/v1/schedules/{id}/materialize` untuk rentang tanggal aktif (mis. hari ini s/d 14 hari ke depan atau tanggal pelaksanaan) sehingga sesi presensi (`SessionDto`) langsung terbentuk dan siap dipakai.
4. Pada halaman `Schedules.tsx`:
   - Menampilkan daftar jadwal (`ScheduleDto`) beserta sesi (`SessionDto`) yang terkait, tombol materialize sesi hari ini, tutup sesi (`POST /api/v1/schedules/sessions/{id}/close`), dan hapus sesi (`DELETE /api/v1/schedules/sessions/{id}`).
   - Jika `DELETE` mengembalikan `409 SESSION_HAS_ATTENDANCE_RECORDS` (K-05), frontend menampilkan pesan backend bahwa sesi sudah memiliki riwayat presensi dan tidak dapat dihapus permanen.

---

## 6. Fitur Tanpa Endpoint Backend & Pembersihan Prototipe (Tahap 5)

1. **Halaman Evaluasi AI (`admin/AiEval.tsx` — APCER/BPCER/FAR/FRR)**:
   - Backend tidak menyediakan endpoint kurva kalibrasi FAR/FRR atau matriks lux laboratorium.
   - Sesuai instruksi Tahap 5, tab **"AI"** (`/admin/evaluasi`) disembunyikan dari `BottomNav` admin (`components/layout.tsx`) dan ubin navigasi `admin/Dashboard.tsx`, sehingga pengguna tidak pernah melihat angka simulasi sebagai data nyata.
2. **Metrik `SCAN_OK` & `p95 scan 1,24s` pada `admin/Dashboard.tsx`**:
   - Array statis `SCAN_OK` dan angka hardcoded `1.24s` dihapus.
   - Digantikan dengan statistik nyata dari `GET /api/v1/attendance/dashboard` (`DashboardStatsDto`) dan ringkasan log validasi nyata dari `GET /api/v1/reports/logs/validation`.
3. **Tren Kehadiran pada `guard/Dashboard.tsx`**:
   - Rumus tiruan `58 + ((d * 7) % 27)` dihapus.
   - Grafik tren kini dihitung murni dari `recentSessions` pada `GET /api/v1/attendance/dashboard` / laporan periode nyata (`GET /api/v1/reports/attendance`). Jika belum ada sesi pada tanggal tertentu, nilai ditampilkan `0%` (atau state kosong bila belum ada data sama sekali).
4. **Penghapusan Komponen Simulasi**:
   - `DemoPicker` dihapus dari `Scan.tsx`, `Enroll.tsx`, `AssistedScan.tsx`, dan `components/charts.tsx`.
   - Kotak "Akun demo" dan `DEMO_PASSWORD` dihapus dari `Login.tsx`, `Guards.tsx`, dan `state/app.tsx`.
   - Tombol "Uji kunci 5 mnt" (`simulateLockout`) dihapus dari `admin/Guards.tsx`; fitur reset sandi penjaga dihubungkan ke `POST /api/v1/admin/users/{userId}/reset-password` melalui modal input sandi baru.
   - Mode kamera palsu (`preview` ketika webcam ditolak) dihapus dari `components/camera.tsx`; jika kamera tidak tersedia atau izin ditolak, tombol scan dinonaktifkan dan pengguna diberikan tombol "Coba lagi izin kamera" serta tautan pengajuan bantuan (`POST /api/v1/help-requests`).
