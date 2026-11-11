# DOKUMENTASI KEAMANAN BACKEND ASRAMA PRESENSI (SECURITY DOCUMENTATION)

Dokumen ini menjabarkan arsitektur, implementasi, dan kebijakan keamanan menyeluruh (*Defense-in-Depth*) pada backend Asrama Presensi Universitas Klabat (UNKLAB).

---

## 1. Arsitektur Keamanan Multilapis (*Defense-in-Depth*)

Backend menerapkan lima lapis pertahanan untuk menjamin kerahasiaan (*confidentiality*), integritas (*integrity*), dan ketersediaan (*availability*) data:

```
+-----------------------------------------------------------------------+
| LAPIS 1: Jaringan & Gerbang Masuk (CORS, Rate Limiting, TLS/HTTPS)    |
+-----------------------------------------------------------------------+
                                  |
                                  v
+-----------------------------------------------------------------------+
| LAPIS 2: Spring Security & Custom JWT Authentication Filter          |
| (Verifikasi Signature, JTI Revocation, Account Active Status, RBAC)   |
+-----------------------------------------------------------------------+
                                  |
                                  v
+-----------------------------------------------------------------------+
| LAPIS 3: Validasi Masukan & Sanitasi Bisnis (DTO, Magic Bytes, Enums) |
+-----------------------------------------------------------------------+
                                  |
                                  v
+-----------------------------------------------------------------------+
| LAPIS 4: Isolasi Database PostgreSQL & Row Level Security (RLS)       |
| (HikariCP -> SET LOCAL ROLE app_backend -> set_app_context(uid, role)) |
+-----------------------------------------------------------------------+
                                  |
                                  v
+-----------------------------------------------------------------------+
| LAPIS 5: Penyimpanan Biometrik Terenkripsi & Storage Berizin Terbatas |
| (Supabase Storage Private, Signed URL 120s, ArcFace 512-d, Audit Log) |
+-----------------------------------------------------------------------+
```

---

## 2. Spring Security & Autentikasi JWT

### A. Konfigurasi `SecurityConfig`
- **Stateless Session:** Backend dikonfigurasi menggunakan `SessionCreationPolicy.STATELESS`. Server tidak menyimpan HTTP session state di memori servlet container, sehingga tahan terhadap serangan session hijacking dan siap untuk horizontal scaling.
- **CSRF Protection:** Dinonaktifkan (`csrf.disable()`) karena arsitektur murni RESTful API stateless yang menggunakan header `Authorization: Bearer <token>` dan bukan cookie berbasis browser.
- **CORS Policy:** Dibatasi secara eksplisit melalui `CorsConfigurationSource`:
  - `allowedOrigins`: Dikendalikan via variabel lingkungan `SECURITY_CORS_ALLOWED_ORIGINS` (contoh: `http://localhost:5173`, `http://localhost:3000`).
  - `allowedMethods`: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.
  - `allowedHeaders`: `Authorization`, `Content-Type`, `Accept`, `X-Requested-With`.
  - `allowCredentials`: `true`.

### B. Arsitektur Custom JWT (Tanpa Supabase Auth)
Sistem autentikasi sepenuhnya dikelola oleh Spring Boot menggunakan tabel `public.users`:
- **Algoritma Tanda Tangan:** HMAC-SHA256 (`Keys.hmacShaKeyFor`) dengan panjang kunci minimal 256-bit (32 byte).
- **Struktur Payload Access Token:**
  - `sub`: User ID (`UUID`).
  - `role`: Role pengguna (`PENGHUNI`, `MONITOR`, `ADMIN`, `VILLAGE_DEAN`).
  - `email`: Alamat email resmi UNKLAB.
  - `nim`: Nomor Induk Mahasiswa (khusus untuk penghuni/resident).
  - `jti`: JSON Token Identifier (UUID acak unik per token).
  - `iat`: Timestamp penerbitan token.
  - `exp`: Timestamp kedaluwarsa token (default: 3.600 detik / 1 jam).
- **Refresh Token Rotation (RTR):**
  - Masa berlaku default: 7 hari.
  - Disimpan dalam tabel `public.refresh_tokens` dengan status pencabutan (`is_revoked`).
  - Setiap kali endpoint `/api/v1/auth/refresh` dipanggil, refresh token lama langsung dicabut dan diterbitkan pasangan token baru.
  - Jika refresh token yang telah dicabut digunakan kembali (*token reuse detection*), seluruh token turunan milik pengguna tersebut langsung dibatalkan demi mencegah kompromi sesi.

### C. Proteksi Akun & Pencegahan Brute-Force
- **Lockout Otomatis:** Jika terjadi kegagalan login sebanyak 5 kali berturut-turut pada akun yang sama, akun akan terkunci secara otomatis selama 5 menit (`locked_until = NOW() + INTERVAL '5 minutes'`).
- **Reset Percobaan:** Percobaan login yang sukses akan langsung mereset `failed_login_attempts` menjadi 0 dan menghapus `locked_until`.
- **Immediate Token Revocation saat Nonaktif:**
  - Ketika administrator menonaktifkan pengguna (`PATCH /api/v1/admin/users/{id}/status`), backend memanggil `jwtTokenService.setUserDisabled(userId, true)` dan mencabut seluruh token aktif.
  - `JwtAuthenticationFilter` secara proaktif memvalidasi status keaktifan sebelum meloloskan request. Request yang membawa token pengguna nonaktif akan langsung ditolak dengan status HTTP 401 Unauthorized (`Akun telah dinonaktifkan oleh administrator`).

---

## 3. Isolasi Database & Row Level Security (RLS)

### A. Prinsip Least Privilege Role Database
Koneksi JDBC HikariCP backend beroperasi dengan switching role per-transaksi:
- Role koneksi dasar membuka transaksi PostgreSQL.
- Pada setiap transaksi bisnis, backend mengeksekusi:
  ```sql
  SET LOCAL ROLE app_backend;
  SELECT public.set_app_context(:userId, :role, :sessionId);
  ```
- **Karakteristik Role `app_backend`:**
  - Bukan superuser.
  - Memiliki hak `NOBYPASSRLS`.
  - Hanya memiliki privilege `SELECT`, `INSERT`, `UPDATE`, `DELETE` pada tabel-tabel operasional.
  - Tidak memiliki privilege `CREATE`, `DROP`, `ALTER`, atau manipulasi skema DDL.

### B. Variabel Konteks Transaksi (`app_context`)
Fungsi `public.set_app_context(p_user_id UUID, p_role TEXT, p_session_id TEXT)` menetapkan variabel sesi lokal:
- `app.current_user_id`: UUID pengguna yang sedang login.
- `app.current_role`: Role pengguna (`PENGHUNI`, `MONITOR`, `ADMIN`, `VILLAGE_DEAN`).
- `app.current_session_id`: ID sesi transaksi atau token JTI.

Variabel ini dievaluasi langsung oleh RLS policies di level kernel PostgreSQL:
- **PENGHUNI:** Hanya dapat melihat dan mengubah data profil sendiri, jadwal asrama sendiri, absensi sendiri, status enrollment sendiri, dan pelanggaran sendiri.
- **MONITOR:** Dapat membaca data presensi gedung yang ditugaskan, memvalidasi presensi manual/bantuan, dan melihat status enrollment.
- **ADMIN:** Akses penuh untuk manajemen pengguna, asrama, jadwal, dan pelaporan audit.
- **VILLAGE_DEAN:** Akses pengawasan universitas, laporan agregat statistik, persetujuan dispensasi/izin tingkat lanjut.

### C. Keamanan Database Function & Search Path
Seluruh database function yang berjalan dengan hak istimewa tinggi (`SECURITY DEFINER`) telah diamankan terhadap serangan *search path hijacking*:
```sql
ALTER FUNCTION public.fn_name(...) SET search_path = public, pg_temp;
```
Hal ini memastikan fungsi hanya mengeksekusi objek di dalam skema `public` resmi dan skema temporer yang terisolasi.

---

## 4. Keamanan Supabase Storage & Foto Biometrik

### A. Isolasi Bucket `face-enrollments`
- Bucket Supabase Storage `face-enrollments` dikonfigurasi sebagai **Private Bucket** (akses publik dinonaktifkan 100%).
- Pengguna umum tidak dapat mengakses atau menebak URL file secara langsung tanpa autentikasi.

### B. Validasi File & Pemeriksaan Magic Bytes
Sebelum foto diunggah ke storage atau diproses ke AI, backend menjalankan validasi ketat:
1. **Pemeriksaan Ukuran:** Maksimal 5 MB per berkas.
2. **Pemeriksaan Ekstensi & MIME:** Hanya menerima ekstensi `.jpg`, `.jpeg`, `.png`, `.webp`.
3. **Pemeriksaan Byte Awal (Magic Bytes):**
   - JPEG: `FF D8 FF`
   - PNG: `89 50 4E 47 0D 0A 1A 0A`
   - WEBP: `52 49 46 46` ... `57 45 42 50`
   Berkas yang menyamarkan ekstensi (misal file biner eksekusi yang dinamai `.jpg`) akan langsung ditolak sebelum menyentuh memori AI atau storage.

### C. Time-Limited Signed URL
- Untuk penayangan foto oleh pihak berwenang (misal validasi oleh Monitor atau Admin), backend menghasilkan **Signed URL** dengan waktu hidup terbatas (TTL: 60 hingga 120 detik).
- Setelah TTL berakhir, URL tidak dapat digunakan kembali.

---

## 5. Privasi Data Biometrik & Perlindungan Vektor Wajah

### A. Persetujuan Biometrik (*Informed Consent*)
Sesuai kepatuhan perlindungan data pribadi dan regulasi PDP:
- Setiap penghuni wajib menandatangani persetujuan digital (`resident_biometric_consents`) sebelum proses face enrollment diizinkan.
- Data consent mencatat versi dokumen persetujuan, timestamp, dan alamat IP klien.
- Penghuni memiliki hak mencabut persetujuan, yang akan mengarsipkan data biometrik dan menonaktifkan metode absensi otomatis via wajah.

### B. Perlindungan Embedding Wajah (ArcFace 512-d)
- Backend tidak menyimpan representasi wajah mentah sebagai acuan permanen identifikasi, melainkan representasi matematis vektor normalisasi 512 dimensi (`vector(512)`).
- Vektor fitur diindeks menggunakan `ivfflat` atau `hnsw` dengan metrik `cosine distance`.
- Vektor wajah tidak dapat direkonstruksi balik menjadi citra wajah asli beresolusi penuh (*irreversibility principle*).

### C. Deteksi Wajah Ganda (*Anti-Duplicate Enrollment*)
- Saat proses finalisasi enrollment, vektor wajah calon penghuni dibandingkan dengan seluruh embedding aktif di asrama.
- Jika kemiripan cosine melampaui ambang batas duplikasi (default: `0.75`), pendaftaran ditolak untuk mencegah satu orang mendaftar atas nama orang lain.

---

## 6. Audit Logging & Perlindungan Riwayat

### A. Tabel Audit yang Terisolasi
- `public.audit_logs`: Mencatat semua mutasi data administratif (perubahan role, aktivasi/deaktivasi akun, penghapusan data, perubahan jadwal).
- `public.validation_logs`: Mencatat setiap upaya verifikasi presensi wajah (waktu, skor kecocokan, skor liveness, status keberhasilan).

### B. Proteksi Anti-Tampering
- RLS policy melarang operasi `UPDATE` dan `DELETE` pada tabel audit bagi role `app_backend`, `authenticated`, maupun `anon`.
- Rekaman audit bersifat *append-only* (hanya boleh `INSERT`).

---

## 7. Ringkasan Matriks Hak Akses Endpoint (RBAC)

| Cakupan Modul | Endpoint Path | Role yang Diizinkan | Metode Autentikasi |
|---|---|---|---|
| Autentikasi | `/api/v1/auth/register` | Publik | Validasi NIM & Email UNKLAB |
| Autentikasi | `/api/v1/auth/login` | Publik | Password Hash BCrypt |
| Autentikasi | `/api/v1/auth/refresh` | Publik | Refresh Token Valid |
| Autentikasi | `/api/v1/auth/logout` | All Roles | Bearer JWT (JTI Revocation) |
| Profil Diri | `/api/v1/residents/me` | PENGHUNI | Bearer JWT + Own Context |
| Enrollment | `/api/v1/enrollment/**` | PENGHUNI | Bearer JWT + Active Resident |
| Presensi | `/api/v1/attendance/verify` | PENGHUNI | Bearer JWT + Geolocation Check |
| Presensi Manual | `/api/v1/attendance/manual-verify` | MONITOR, ADMIN | Bearer JWT + Authority Check |
| Manajemen Jadwal | `/api/v1/schedules/**` | ADMIN, VILLAGE_DEAN | Bearer JWT + Schedule Admin Role |
| Manajemen Pengguna | `/api/v1/admin/users/**` | ADMIN | Bearer JWT + Admin Role |
| Laporan & Audit | `/api/v1/reports/**` | ADMIN, VILLAGE_DEAN | Bearer JWT + Supervisor Role |
| Status AI | `/api/v1/attendance/ai-status` | Publik | Tanpa Token (Health Probe) |
