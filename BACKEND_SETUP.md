# BACKEND SETUP & DEPLOYMENT GUIDE — ASRAMA PRESENSI

Dokumen ini menjelaskan cara menyiapkan, mengonfigurasi, menjalankan, menguji, dan membangun paket executable backend **Spring Boot 3.3.5 (Java 17)** untuk sistem **Asrama Presensi**.

---

## 1. Arsitektur & Spesifikasi Sistem

| Komponen | Spesifikasi & Teknologi | Keterangan |
|---|---|---|
| **Runtime Backend** | Java 17 LTS (OpenJDK 17 / Oracle JDK 17) | Spring Boot 3.3.5 |
| **Build Tool** | Apache Maven 3.9+ | Target artifact: `asrama-presensi-backend-1.0.0.jar` |
| **Zona Waktu Server** | `Asia/Makassar` (WITA / UTC+08:00) | Ditetapkan pada level JVM entrypoint & connection string JDBC |
| **Database** | Supabase PostgreSQL 17 (`tjgttljfdlcwxbregzqs`) | Role transaksi `app_backend`, RLS aktif di 26 tabel |
| **Autentikasi** | Custom JWT (JJWT 0.12.6) + Spring Security 6.3 | Access Token (15m), Refresh Token (7d), **tanpa Supabase Auth** |
| **Layanan AI** | Python FastAPI (DeepFace / ArcFace 512-d) | HTTP Client via `RestClient`, timeout koneksi 1000ms, baca 2200ms |
| **Storage Biometrik** | Supabase Storage (`face-enrollments`) | Bucket privat, path regex tervalidasi, inspeksi magic bytes |

---

## 2. Prasyarat Sistem

Sebelum menjalankan atau membangun aplikasi, pastikan perangkat Anda memiliki:

1. **Java Development Kit (JDK) 17 LTS:**
   ```powershell
   java -version
   # Pastikan output menampilkan OpenJDK atau Oracle JDK versi 17.x
   ```
2. **Apache Maven 3.9+:**
   ```powershell
   mvn -version
   ```
3. **Konektivitas ke Database Supabase:**
   - Host database: `aws-0-ap-southeast-1.pooler.supabase.com:5432`
   - Skema database 100% tervalidasi melalui [`database/final/FINAL_DATABASE_SETUP.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/final/FINAL_DATABASE_SETUP.sql).
4. **Layanan Eksternal AI FastAPI:**
   - Berjalan pada `http://localhost:8000` (atau URL yang dikonfigurasi).

---

## 3. Struktur Direktori Backend

```text
backend/
├── pom.xml                                    # Definisi dependensi & build plugins Maven
├── .env.example                               # Template variabel lingkungan lokal
└── src/
    ├── main/
    │   ├── java/id/ac/unklab/asrama/
    │   │   ├── AsramaPresensiApplication.java # Entrypoint aplikasi & konfigurasi TimeZone Asia/Makassar
    │   │   ├── config/                        # AppProperties, OpenApiConfig, RestClientConfig
    │   │   ├── common/                        # ApiResponse, DomainEnums, BusinessException, GlobalExceptionHandler
    │   │   ├── security/                      # SecurityConfig, JwtTokenService, JwtAuthenticationFilter,
    │   │   │                                  # RlsContextManager, RlsTransactionAspect, RateLimitFilter, SecurityUtils
    │   │   ├── auth/                          # Registrasi NIM resmi, Login, Lockout 5x/5m, Refresh Token, Logout
    │   │   ├── resident/                      # Profil penghuni, consent wajah (P-05), kontak darurat, paginasi
    │   │   ├── enrollment/                    # 5 Pose wajah, validasi kualitas/liveness, anti-duplikat, promosi atomik
    │   │   ├── attendance/                    # Scan mandiri, bantuan penjaga, manual, dashboard, status AI
    │   │   ├── schedule/                      # Jadwal ONE_TIME & RECURRING, sesi, geofence PostGIS, riwayat audit jadwal
    │   │   ├── admin/                         # CRUD penghuni, import CSV per baris, akun MONITOR, reset password
    │   │   ├── violation/                     # Poin pelanggaran, histori poin, pembinaan (coaching), tiket bantuan
    │   │   ├── report/                        # Rekap periode, ekspor CSV aman formula injection, audit/validation logs
    │   │   ├── storage/                       # SupabaseStorageService (verifikasi kepemilikan & magic bytes gambar)
    │   │   └── ai/                            # FastApiAiClient, health check & kontrak DTO AI
    │   └── resources/
    │       └── application.yml                # Konfigurasi HikariCP, JPA, Spring Security, dan App Properties
    └── test/
        └── java/id/ac/unklab/asrama/
            ├── BackendRequirementsSuiteTest.java   # 14 pengujian unit fungsional & concurrency
            └── SecurityAndRestIntegrationTest.java  # 7 pengujian integrasi REST, filter security & OpenAPI
```

---

## 4. Konfigurasi Variabel Lingkungan

Backend membaca variabel lingkungan melalui sintaks `${NAMA_VAR:default}` pada [`application.yml`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/backend/src/main/resources/application.yml).

Salin file [`.env.example`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/.env.example) atau atur variabel lingkungan pada terminal Anda:

```powershell
$env:DB_URL="jdbc:postgresql://aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
$env:DB_USERNAME="postgres.tjgttljfdlcwxbregzqs"
$env:DB_PASSWORD="<ISI_PASSWORD_DATABASE_ANDA>"
$env:APP_RLS_ENABLED="true"
$env:JWT_SECRET="<MINIMAL_32_KARAKTER_UNTUK_HMAC_SHA256>"
$env:JWT_ACCESS_EXP_MS="900000"
$env:JWT_REFRESH_EXP_MS="604800000"
$env:SUPABASE_URL="https://tjgttljfdlcwxbregzqs.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<ISI_SERVICE_ROLE_KEY_SUPABASE>"
$env:AI_SERVICE_BASE_URL="http://localhost:8000"
$env:AI_SERVICE_API_KEY="<ISI_SHARED_SECRET_FASTAPI>"
```

> [!CAUTION]
> Jangan pernah memasukkan password database asli, JWT secret produksi, atau Supabase Service Role Key ke dalam version control (git).

---

## 5. Kompilasi, Pengujian, dan Pembangunan Paket

### A. Menjalankan Seluruh Pengujian Otomatis
```powershell
cd backend
mvn clean test
```
Seluruh 21 pengujian otomatis (14 unit test fungsional dan 7 web/security integration test) akan dieksekusi:
- **Hasil:** `Tests run: 21, Failures: 0, Errors: 0, Skipped: 0`
- **Waktu Eksekusi:** ~12-14 detik

### B. Membangun Paket JAR Executable (Production Build)
```powershell
mvn clean package
```
Perintah ini akan mengompilasi seluruh kode sumber Java, menjalankan seluruh pengujian, dan mengemas aplikasi menjadi fat-JAR:
- **Lokasi Artifact:** `backend/target/asrama-presensi-backend-1.0.0.jar`

---

## 6. Menjalankan Backend

### Cara 1: Menggunakan Maven Plugin
```powershell
cd backend
mvn spring-boot:run
```

### Cara 2: Menjalankan Langsung File JAR
```powershell
java -Duser.timezone=Asia/Makassar -jar target/asrama-presensi-backend-1.0.0.jar
```

Aplikasi akan menyala pada port `8080`.

---

## 7. Verifikasi Layanan Berjalan

Setelah server aktif, verifikasi fungsionalitas dasar:

1. **Health Check Endpoint:**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:8080/actuator/health"
   # Output: {"status":"UP"}
   ```
2. **Ketersediaan Layanan AI:**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:8080/api/v1/attendance/ai-status"
   ```
3. **Dokumentasi Interaktif Swagger UI:**
   Buka browser pada alamat:
   `http://localhost:8080/swagger-ui.html`
4. **Spesifikasi Lengkap OpenAPI 3.0 (JSON):**
   `http://localhost:8080/v3/api-docs`
