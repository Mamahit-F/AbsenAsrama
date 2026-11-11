# PROMPT UNTUK ANTIGRAVITY — Finalisasi Frontend Asrama Presensi (siap integrasi)

> Salin seluruh isi di bawah garis ini ke Antigravity. Buka folder `Absenasrama` (root repo, berisi `frontend/`, `backend/`, `database/`) sebagai workspace.

---

## PERAN & TUJUAN

Kamu adalah engineer frontend senior. Tugasmu: **mengubah frontend `frontend/` dari prototype (data tiruan) menjadi frontend final yang terhubung ke backend nyata**, tanpa mengubah tampilan yang sudah jadi. Setelah selesai, seluruh alur utama harus berjalan terhadap backend Spring Boot di `http://localhost:8080`.

Kerjakan bertahap sesuai urutan di bagian "TAHAPAN". Setelah tiap tahap, jalankan `npx tsc --noEmit` dan `npm run build` di `frontend/`, perbaiki semua error sebelum lanjut. Bahasa antarmuka tetap **Bahasa Indonesia**, zona waktu **WITA (Asia/Makassar)**.

## KONTEKS PROYEK

- Aplikasi presensi kegiatan kerohanian asrama Universitas Klabat (UNKLAB), mobile-first (lebar maks 430px).
- Frontend: React + Vite + TypeScript + Tailwind v4 + `motion/react`, `react-router-dom`, `lucide-react`. Folder `frontend/src/`:
  - `pages/` (public, resident, guard, admin, shared), `components/` (layout, ui, charts, camera), `state/` (`app.tsx` auth tiruan, `store.tsx` data tiruan), `lib/utils.ts`.
- Backend: Spring Boot 3.3.5 di `backend/`, base URL `http://localhost:8080`, Swagger di `/swagger-ui.html`, OpenAPI di `/v3/api-docs`. CORS mengizinkan `http://localhost:5173,http://localhost:3000` (ubah via env `CORS_ALLOWED_ORIGINS`). Layanan AI pengenalan wajah terpisah (FastAPI), diakses lewat backend.
- Dokumen acuan di root repo: `BACKEND_API_DOCUMENTATION.md`, `FRONTEND_INTEGRATION_GUIDE.md`, `BACKEND_DATABASE_CONTRACT.md`, `BACKEND_SECURITY_DOCUMENTATION.md`, `BACKEND_SETUP.md`, `BACKEND_ENVIRONMENT_GUIDE.md`.

## ATURAN KERAS (JANGAN DILANGGAR)

1. **JANGAN mengubah desain visual.** Kelas Tailwind, warna, font (Outfit + Figtree), animasi, dan tata letak yang ada dipertahankan. Boleh menambah state *memuat / kosong / gagal* dengan komponen yang sudah ada (`Empty`, `Badge`, `Button loading`, dsb.) dan gaya yang sama.
2. **Sumber kebenaran kontrak = kode backend**, bukan dokumen. Dua dokumen di root saling bertentangan (path dan bentuk amplop respons berbeda). Sebelum menulis klien API, baca controller dan DTO di `backend/src/main/java/**` (cari `*Controller.java`, `ApiResponse`) dan/atau `/v3/api-docs`. Backend menerima beberapa alias path; **pakai path utama dari `BACKEND_API_DOCUMENTATION.md`** (mis. `/attendance/scan`, `/enrollments/start`, `/enrollments/{id}/poses/{pose}`, `/enrollments/{id}/complete`).
3. **Jangan pernah mengarang data.** Tidak boleh ada skor liveness/kecocokan acak, hasil scan yang dipilih manual, angka grafik yang ditulis langsung, atau data contoh yang tampil sebagai data asli. Kalau backend tidak menyediakan datanya, tampilkan state kosong yang jujur.
4. **Jangan menyimpan password, embedding wajah, atau foto di localStorage.** Backend tidak pernah mengembalikan embedding (`K-01`); frontend juga tidak boleh mencoba.
5. **Jangan mengubah backend/database** kecuali diminta. Kalau menemukan ketidakcocokan kontrak, catat di `FRONTEND_INTEGRATION_NOTES.md` dan buat adapter di frontend.
6. Jangan menghapus fitur yang sudah ada tanpa menggantinya. Jangan menambah dependensi besar; **gunakan `fetch` bawaan** (tanpa axios) kecuali ada alasan kuat. Ruang disk terbatas.
7. Semua teks error untuk pengguna dalam Bahasa Indonesia dan memakai `message` dari backend bila ada.

## TAHAPAN

### Tahap 0 — Persiapan & pemetaan
- Jalankan backend sesuai `BACKEND_SETUP.md` / `BACKEND_ENVIRONMENT_GUIDE.md` (database PostgreSQL + PostGIS, layanan AI bila tersedia). Pastikan `GET /api/v1/attendance/ai-status` dan Swagger bisa dibuka. Jika backend tidak bisa dijalankan, **berhenti dan laporkan penyebabnya**; jangan lanjut menebak kontrak.
- Dari `/v3/api-docs` atau DTO, buat daftar bentuk request/response tiap endpoint yang dipakai (login, register, me, residents, schedules, sessions, attendance, enrollments, admin, reports, help-requests). Simpan ringkasannya di `frontend/FRONTEND_INTEGRATION_NOTES.md`.
- Konfirmasi bentuk amplop respons sebenarnya (`success`, `code`, `message`, `data`, `details`, `timestamp`) dan format error (400/401/403/404/409/423/503).

### Tahap 1 — Lapisan API (`frontend/src/api/`)
- `client.ts`: pembungkus `fetch` dengan base `/api/v1`; tambah proxy di `vite.config.ts` (`/api/v1` → `http://localhost:8080`); injeksi `Authorization: Bearer`; refresh token otomatis saat 401 (satu kali, antrekan permintaan paralel); dukung `multipart/form-data` (jangan set `Content-Type` manual) dan unduhan CSV/blob.
- Buat `ApiError` (status, code, message, details) dan fungsi yang memetakan `details` field-validasi ke pesan per kolom form.
- Modul per domain: `auth.ts`, `residents.ts`, `schedules.ts`, `attendance.ts`, `enrollment.ts`, `admin.ts`, `reports.ts`, `helpRequests.ts`. Semua bertipe (TypeScript) sesuai DTO.
- Simpan token dengan aman: access token di memori + refresh token di storage; pulihkan sesi saat halaman dimuat ulang lewat `GET /auth/me`.
- Tambah pengaturan zona waktu: backend memakai WITA, jangan ubah tanggal dengan `toISOString()` (pakai util yang sudah ada di `lib/utils.ts`).

### Tahap 2 — Autentikasi & peran
- Ganti `state/app.tsx` (login tiruan, `DEMO_PASSWORD`) dengan login nyata: `POST /auth/login`, `/auth/register` (penghuni dengan NIM resmi), `/auth/logout`, `/auth/refresh`, `/auth/change-password`.
- Pemetaan peran backend → rute: `PENGHUNI` → `/penghuni`, `MONITOR` → `/penjaga`, `ADMIN` → `/admin`, `VILLAGE_DEAN` → perlakukan sebagai `/penjaga` (read-mostly) sampai ada halaman sendiri; catat ini di notes.
- Tangani: 401 (sesi habis → ke `/masuk`), 403 (halaman "Akses ditolak"), **423 LOCKED** (akun terkunci 5 menit: tampilkan hitung mundur dari data backend, jangan hitung sendiri), 429 (rate limit).
- Hapus panel "Akun demo" di `Login.tsx` dan petunjuk sandi default di `admin/Guards.tsx`.
- `RequireRole`/guard rute tetap dipakai, tapi berdasarkan peran dari backend.

### Tahap 3 — Ganti `state/store.tsx` dengan data nyata
- Hapus seluruh seed (`seedResidents`, `seedSessions`, `seedAttendance`, `seedGuards`, `seedSys`, `seedAudit`) dan mutator lokal. Ganti dengan hook per halaman (mis. `useResidents`, `useSessions`, `useAttendance`) yang memuat dari API, punya `loading`/`error`/`refetch`, dan memperbarui UI setelah mutasi.
- Tambah state *memuat* (skeleton/spinner dengan gaya yang ada) dan *gagal* (pesan + tombol coba lagi) pada setiap layar.
- Petakan model:
  - Peran/sesi: frontend punya satu konsep "sesi" (mode tanggal/berulang); backend memisahkan **schedule** (jadwal, sekali/berulang) dan **session** (sesi presensi konkret) + `materialize` + geofence. Sesuaikan `guard/Schedules.tsx` dan `ScheduleForm.tsx` ke model backend (buat jadwal → materialize → atur geofence → tutup sesi). Hapus sesi yang sudah punya presensi ditolak backend (`409`, aturan K-05): tampilkan pesannya, jangan "arsipkan" sendiri.
  - Penjaga = akun `MONITOR`: daftar/aktif-nonaktif/reset sandi lewat `/admin/users`. Hitungan gagal login & waktu kunci datang dari backend (jika ada), bukan disimulasikan.
  - Status wajah: dari `/residents/me` dan `/enrollments/residents/{id}/active-profile` (metadata saja).
  - Waktu & tanggal dari backend dalam WITA.
- Dashboard penghuni: ringkasan dari `/attendance/me` + sesi aktif dari `/schedules/sessions/active`.
- Dashboard penjaga: `/attendance/dashboard` dan `/attendance/sessions/{id}/recap`. Tren 14 hari **hanya** dari data nyata; jika tidak tersedia, sembunyikan grafik atau tampilkan state kosong. Hapus nilai cadangan `58 + ((d * 7) % 27)`.
- Dashboard admin: statistik dari endpoint yang ada. Hapus konstanta `SCAN_OK` dan angka "p95 1,24 s" yang ditulis langsung.
- Impor CSV (`admin/Import.tsx`): kirim berkas asli ke `POST /admin/residents/import-csv`, tampilkan hasil per baris dari respons; hapus contoh baris "sengaja disertakan".
- Rekap (`guard/Export.tsx`): `GET /reports/attendance` untuk pratinjau dan `/reports/attendance/export-csv` untuk unduhan. Jangan membangun CSV di klien.
- Log (`admin/Logs.tsx`): `/reports/logs/audit`, `/logs/validation`, `/logs/attendance-history`, dengan paginasi `limit`/`offset` (maks 500) dan pencarian `search`.
- Daftar penghuni (`admin/Residents.tsx`): `/residents` dengan `search`, `status`, `category`, paginasi server-side; tambah/ubah/nonaktifkan/hapus lewat `/admin/residents*`.

### Tahap 4 — Fitur AI dengan kamera sungguhan
- **Persetujuan data wajah** (`Consent.tsx`): `GET/POST /residents/{id}/consents` (+ `/revoke`). Enrollment wajib punya consent aktif.
- **Enrollment 5 pose** (`Enroll.tsx`): `POST /enrollments/start` → unggah tiap pose `LURUS, KANAN, KIRI, ATAS, BAWAH` sebagai `multipart` (`photo`) ke `/enrollments/{id}/poses/{pose}` → `POST /enrollments/{id}/complete`. Tampilkan umpan balik penolakan dari backend per pose dan izinkan ulang per pose (P-04). Tangani `409` (wajah ganda, S-05).
- **Presensi mandiri** (`Scan.tsx`): sebelum membuka kamera panggil `GET /attendance/ai-status`; bila tidak sehat, tampilkan banner + jalur "Minta bantuan" (`POST /help-requests`). Ambil frame, ambil GPS (`navigator.geolocation`), kirim `multipart` ke `POST /attendance/scan` (foto, `sessionId`, `latitude`, `longitude` sesuai DTO aktual). Tampilkan hasil dari backend: sukses, liveness gagal, tidak cocok, di luar geofence (400), sudah presensi (409, idempoten P-09), AI offline (503).
- **Bantu scan penjaga** (`AssistedScan.tsx`): `POST /attendance/scan/guard-assisted` dengan `residentId` + alasan; **Manual** (`Manual.tsx`): `POST /attendance/manual` dengan alasan wajib.
- **Hapus `DemoPicker`** (komponen dan semua pemakaiannya di `Scan`, `Enroll`, `AssistedScan`), hasil acak (`Math.random` di `Scan.tsx`), dan semua `store.log(...)` tiruan.
- **Kamera** (`components/camera.tsx`): hapus "Mode pratinjau (kamera tidak tersedia)" yang berpura-pura memindai. Bila kamera ditolak/tidak ada, tampilkan penjelasan, tombol coba lagi, dan jalur bantuan; jangan lanjutkan proses. Pastikan stream kamera dilepas saat meninggalkan halaman. Frame diambil sebagai JPEG dari `<video>` ke `<canvas>`.
- Jangan simpan foto di state lama setelah dikirim.

### Tahap 5 — Fitur tanpa endpoint & bersih-bersih
- **Evaluasi AI** (`admin/AiEval.tsx`, metrik APCER/BPCER/FAR/FRR, kurva ambang, p95): cari endpoint di backend. Jika **tidak ada**, sembunyikan menu "AI" dari navigasi admin dan rute-nya, dan catat di notes. **Jangan** menyisakan angka tiruan. Jika backend memang punya datanya, hubungkan.
- Hapus tombol "Simulasi 5x gagal sandi" di `admin/Guards.tsx`.
- Hapus semua teks "demo"/"prototipe"/"simulasi" yang tersisa. Cek dengan: `grep -rniE "demo|prototip|prototype|simulasi|mock|seed|DEMO_PASSWORD|Math.random" frontend/src` (hasil sah hanya komentar yang menjelaskan hal lain).
- Hapus `sleep()` dan `setTimeout` yang dipakai untuk menunda palsu (`Login.tsx`, `Register.tsx`, `Scan.tsx`).
- Hapus file/kode mati yang tidak lagi terpakai setelah `store.tsx` dan `app.tsx` diganti.

### Tahap 6 — Kualitas & ketahanan
- Error boundary tingkat aplikasi + halaman 404 + "Akses ditolak".
- Semua form: validasi sisi klien yang ringan + tampilkan `details` field dari backend.
- Mencegah kirim ganda (tombol `loading`, disable saat proses) khususnya presensi dan enrollment.
- Aksesibilitas tetap: label form, fokus terlihat, `prefers-reduced-motion`.
- Variabel lingkungan: `frontend/.env.example` (mis. `VITE_API_BASE_URL=/api/v1`), tanpa rahasia.
- Perbarui `README`/`FRONTEND_INTEGRATION_NOTES.md`: cara menjalankan, daftar endpoint yang dipakai, keputusan pemetaan (peran, jadwal vs sesi), dan hal yang belum didukung backend.

## KRITERIA SELESAI (verifikasi satu per satu, laporkan hasilnya)

- [ ] `npx tsc --noEmit` dan `npm run build` bersih tanpa error/peringatan baru.
- [ ] `grep` kata kunci prototype (lihat Tahap 5) tidak menemukan sisa kode prototype.
- [ ] Tidak ada impor dari `state/store.tsx` seed; tidak ada `DEMO_PASSWORD`, `DemoPicker`, `Math.random()` untuk hasil bisnis.
- [ ] Terhadap backend yang berjalan, alur ini lolos secara manual (sertakan tangkapan layar/log): daftar penghuni → login → persetujuan data wajah → enrollment 5 pose → presensi mandiri berhasil; presensi kedua di sesi yang sama ditolak (409); login salah 5× → akun terkunci (423); login sebagai monitor → bantu scan & manual; admin → tambah penghuni, impor CSV, nonaktifkan akun, lihat log, unduh CSV.
- [ ] Muat ulang halaman mempertahankan sesi; token kedaluwarsa memicu refresh, lalu logout bersih bila gagal.
- [ ] Tampilan tetap sama seperti sebelum integrasi (bandingkan beberapa layar di lebar 375px), tanpa horizontal scroll.
- [ ] `FRONTEND_INTEGRATION_NOTES.md` berisi daftar endpoint, pemetaan model, dan semua celah kontrak yang ditemukan.

## CARA MELAPOR

Setelah tiap tahap, tulis ringkasan singkat: apa yang diubah, file utama yang tersentuh, hasil `tsc`/`build`, dan keputusan atau asumsi yang kamu ambil. Bila ada ketidakcocokan kontrak backend yang tidak bisa diatasi di frontend, **berhenti dan tanyakan** daripada menebak. Jangan melakukan `git commit`, `git push`, atau menghapus folder `_backup/` tanpa diminta.
