# PANDUAN VARIABEL LINGKUNGAN (ENVIRONMENT GUIDE)

Dokumen ini menyediakan referensi lengkap seluruh konfigurasi dan variabel lingkungan (*environment variables*) yang didukung oleh backend Asrama Presensi, beserta nilai default, rekomendasi produksi, dan aturan penanganan rahasia (*secrets management*).

---

## 1. Ikhtisar Konfigurasi

Aplikasi Spring Boot membaca variabel lingkungan dengan struktur fallback hierarkis:
1. Variabel lingkungan sistem operasi (*System Environment Variables*).
2. Properti JVM (`-Dkey=value`).
3. Berkas konfigurasi bawaan `application.yml`.

> [!IMPORTANT]
> **Aturan Keamanan:** Jangan pernah menyimpan kredensial aktual (seperti password database, JWT secret, atau service role key) ke dalam repositori Git atau berkas teks terbuka. Gunakan secret manager, environment injection pada pipeline CI/CD, atau file `.env` lokal yang masuk ke dalam `.gitignore`.

---

## 2. Tabel Referensi Variabel Lingkungan

### A. Konfigurasi Server & HTTP
| Nama Variabel Lingkungan | Nilai Default | Tipe Data | Deskripsi & Rekomendasi |
|---|---|---|---|
| `SERVER_PORT` | `8080` | Integer | Port jaringan tempat server mendengarkan HTTP request. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3000` | String (CSV) | Daftar origin frontend yang diizinkan melakukan cross-origin request. Di produksi, atur ke domain frontend resmi (contoh: `https://asrama.unklab.ac.id`). |

### B. Konfigurasi Database PostgreSQL & HikariCP
| Nama Variabel Lingkungan | Nilai Default | Tipe Data | Deskripsi & Rekomendasi |
|---|---|---|---|
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?options=-c%20TimeZone=Asia/Makassar` | String (JDBC URL) | Alamat koneksi database Supabase melalui session/transaction pooler dengan timezone `Asia/Makassar`. |
| `SPRING_DATASOURCE_USERNAME` | `postgres.tjgttljfdlcwxbregzqs` | String | Akun database perantara pooler Supabase. |
| `SPRING_DATASOURCE_PASSWORD` | *(Placeholder)* | String | Password akun database PostgreSQL. Wajib diisi pada lingkungan aktif. |
| `DB_POOL_MAX_SIZE` | `15` | Integer | Jumlah maksimum koneksi aktif di HikariCP connection pool. Disarankan 10–20 pada mode pooler session. |
| `DB_POOL_MIN_IDLE` | `3` | Integer | Jumlah minimum koneksi idle yang dipertahankan pool. |
| `APP_RLS_ENABLED` | `true` | Boolean | Mengaktifkan switching `SET LOCAL ROLE app_backend` dan `public.set_app_context` pada setiap transaksi. Wajib `true` di produksi. |

### C. Konfigurasi Spring Security & JWT
| Nama Variabel Lingkungan | Nilai Default | Tipe Data | Deskripsi & Rekomendasi |
|---|---|---|---|
| `JWT_SECRET` | *(Default Development String)* | String | Kunci rahasia HMAC-SHA256 berukuran minimal 256-bit (32 karakter acak berkualitas tinggi). Wajib diganti di produksi! |
| `JWT_ISSUER` | `asrama-presensi-backend` | String | Pengenal penerbit token JWT. |
| `JWT_ACCESS_EXPIRATION_MS` | `900000` (15 menit) | Long | Durasi masa berlaku Access Token dalam milidetik. Standar: 900.000 ms (15 m) hingga 3.600.000 ms (1 jam). |
| `JWT_REFRESH_EXPIRATION_MS` | `604800000` (7 hari) | Long | Durasi masa berlaku Refresh Token dalam milidetik. |
| `RATE_LIMIT_AUTH_RPM` | `20` | Integer | Batas request autentikasi per menit per alamat IP untuk mencegah brute-force. |
| `RATE_LIMIT_SCAN_RPM` | `30` | Integer | Batas request verifikasi scan presensi per menit per pengguna. |

### D. Konfigurasi Biometrik Wajah & Ambang Batas AI
| Nama Variabel Lingkungan | Nilai Default | Tipe Data | Deskripsi & Rekomendasi |
|---|---|---|---|
| `FACE_SIMILARITY_THRESHOLD` | `0.65` | Double | Ambang batas kemiripan kosinus minimal untuk memvalidasi kehadiran resident. Rentang: `0.60`–`0.75`. |
| `FACE_DUPLICATE_THRESHOLD` | `0.70` | Double | Ambang batas kemiripan kosinus untuk mendeteksi apakah wajah resident sudah terdaftar di akun lain. |
| `FACE_LIVENESS_THRESHOLD` | `0.70` | Double | Skor minimal anti-spoofing (PAD) dari MiniFASNet. Nilai $\ge 0.70$ menjamin citra live, bukan foto/layar digital. |
| `FACE_QUALITY_THRESHOLD` | `0.65` | Double | Skor kualitas citra minimal (kombinasi ketajaman blur score dan pencahayaan). |
| `FACE_MODEL_VERSION` | `ArcFace-r100` | String | Versi model neural network ekstraksi fitur wajah. |
| `FACE_RETENTION_DAYS` | `90` | Integer | Batas retensi penyimpanan data foto sementara sebelum diarsipkan/dibersihkan. |

### E. Konfigurasi Microservice AI FastAPI
| Nama Variabel Lingkungan | Nilai Default | Tipe Data | Deskripsi & Rekomendasi |
|---|---|---|---|
| `AI_SERVICE_BASE_URL` | `http://localhost:8000` | String (URL) | URL basis layanan microservice Python FastAPI. Di produksi dapat berupa URL service internal container. |
| `AI_SERVICE_API_KEY` | `dev-ai-internal-key` | String | Kunci API HTTP header untuk autentikasi internal antar-layanan (m2m). |
| `AI_CONNECT_TIMEOUT_MS` | `1000` | Integer | Batas waktu timeout inisiasi koneksi socket HTTP ke FastAPI (milidetik). |
| `AI_READ_TIMEOUT_MS` | `2200` | Integer | Batas waktu timeout membaca hasil inferensi model dari FastAPI (milidetik). |

### F. Konfigurasi Supabase Storage
| Nama Variabel Lingkungan | Nilai Default | Tipe Data | Deskripsi & Rekomendasi |
|---|---|---|---|
| `SUPABASE_URL` | `https://tjgttljfdlcwxbregzqs.supabase.co` | String (URL) | URL proyek Supabase cloud. |
| `SUPABASE_SERVICE_ROLE_KEY` | *(Placeholder)* | String | Service role key Supabase yang digunakan oleh backend untuk mengunggah dan mengelola signed URL pada bucket privat. |
| `SUPABASE_FACE_BUCKET` | `face-enrollments` | String | Nama bucket privat untuk penyimpanan foto pendaftaran biometrik resident. |

---

## 3. Contoh Templat Berkas `.env` untuk Pengembangan Lokal

Simpan sebagai `.env.local` di folder `backend/` (pastikan terdaftar di `.gitignore`):

```bash
# ==========================================
# ASRAMA PRESENSI BACKEND - LOCAL ENVIRONMENT
# ==========================================

SERVER_PORT=8080
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Database Supabase Pooler
SPRING_DATASOURCE_URL=jdbc:postgresql://aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?options=-c%20TimeZone=Asia/Makassar
SPRING_DATASOURCE_USERNAME=postgres.tjgttljfdlcwxbregzqs
SPRING_DATASOURCE_PASSWORD=RahasiaPasswordDatabaseLokal123!
DB_POOL_MAX_SIZE=10
DB_POOL_MIN_IDLE=2
APP_RLS_ENABLED=true

# Keamanan JWT
JWT_SECRET=S4ng4tRah4s1aD4nKuatM1n1mal32KarakterPanjang2026!
JWT_ISSUER=asrama-presensi-backend
JWT_ACCESS_EXPIRATION_MS=3600000
JWT_REFRESH_EXPIRATION_MS=604800000

# AI Microservice
AI_SERVICE_BASE_URL=http://localhost:8000
AI_SERVICE_API_KEY=dev-ai-internal-key
AI_CONNECT_TIMEOUT_MS=2000
AI_READ_TIMEOUT_MS=5000

# Supabase Storage
SUPABASE_URL=https://tjgttljfdlcwxbregzqs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...
SUPABASE_FACE_BUCKET=face-enrollments
```

---

## 4. Cara Menjalankan dengan Environment Variable

### Di Terminal Bash / macOS / Linux:
```bash
export SPRING_DATASOURCE_PASSWORD="PasswordAktual"
export JWT_SECRET="KunciSecretProduksiMinimal32Karakter"
export SUPABASE_SERVICE_ROLE_KEY="eyJh..."
mvn spring-boot:run
```

### Di Windows PowerShell:
```powershell
$env:SPRING_DATASOURCE_PASSWORD="PasswordAktual"
$env:JWT_SECRET="KunciSecretProduksiMinimal32Karakter"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJh..."
mvn spring-boot:run
```

### Melalui Flag JVM Jar File:
```bash
java -DSPRING_DATASOURCE_PASSWORD="PasswordAktual" \
     -DJWT_SECRET="KunciSecretProduksiMinimal32Karakter" \
     -jar target/asrama-presensi-backend-1.0.0.jar
```
