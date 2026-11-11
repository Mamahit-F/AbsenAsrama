# PANDUAN INTEGRASI FRONTEND (FRONTEND INTEGRATION GUIDE)

Panduan komprehensif ini ditujukan bagi pengembang frontend (React, Vite, Tailwind CSS, Motion) untuk mengintegrasikan antarmuka pengguna dengan REST API backend Asrama Presensi Universitas Klabat (UNKLAB).

---

## 1. Konfigurasi Dasar Klien & Endpoint

### A. Base URL & Reverse Proxy
Dalam pengembangan lokal menggunakan Vite, disarankan menggunakan fitur proxy pada `vite.config.ts`:
```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```
Dengan proxy di atas, semua pemanggilan API dari frontend cukup menggunakan path relatif: `/api/v1/...`.

### B. Format Header Permintaan
Setiap permintaan ke endpoint terproteksi wajib menyertakan token JWT:
```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
```
*(Catatan: Untuk upload berkas seperti foto wajah, gunakan `multipart/form-data` tanpa mengatur `Content-Type` secara manual agar boundary terpasang otomatis oleh browser).*

---

## 2. Struktur Standar Respons API

Backend menerapkan pembungkus amplop konsisten (`ApiResponse<T>`) untuk seluruh endpoint:

### A. Respons Berhasil (HTTP 200 / 201)
```json
{
  "success": true,
  "message": "Operasi berhasil dijalankan",
  "data": { ... },
  "timestamp": "2026-11-10T14:30:00+08:00"
}
```

### B. Respons Gagal / Validasi (HTTP 400 / 401 / 403 / 404 / 500)
```json
{
  "success": false,
  "message": "Kredensial login tidak valid atau password salah",
  "data": null,
  "timestamp": "2026-11-10T14:30:00+08:00"
}
```

---

## 3. Manajemen Token & Interceptor Autentikasi (Axios)

Gunakan Axios interceptor untuk menangani injeksi access token dan otomatisasi refresh token:

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
});

// Request Interceptor: Sisipkan Access Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response Interceptor: Tangani 401 & Refresh Token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post('/api/v1/auth/refresh', {
          refreshToken,
        });

        const newAccessToken = data.data.accessToken;
        const newRefreshToken = data.data.refreshToken;

        localStorage.setItem('access_token', newAccessToken);
        localStorage.setItem('refresh_token', newRefreshToken);

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshErr) {
        // Token kadaluwarsa atau akun dinonaktifkan
        localStorage.clear();
        window.location.href = '/login?expired=true';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

## 4. Alur Integrasi Pendaftaran Biometrik (Face Enrollment)

Proses enrollment mengharuskan resident mengambil 5 pose wajah secara interaktif:
1. `LURUS` (alias: `FRONTAL` / `FRONT` — Menghadap lurus ke depan)
2. `KANAN` (alias: `SLIGHT_RIGHT` / `RIGHT` — Menoleh sedikit ke kanan)
3. `KIRI` (alias: `SLIGHT_LEFT` / `LEFT` — Menoleh sedikit ke kiri)
4. `ATAS` (alias: `SLIGHT_UP` / `UP` — Sedikit menengadah ke atas)
5. `BAWAH` (alias: `SLIGHT_DOWN` / `DOWN` — Sedikit menunduk ke bawah)

*(Catatan: Backend menerima baik kode Indonesia `LURUS` maupun alias Inggris `FRONTAL` secara fleksibel).*

```
[Mulai] -> Cek Consent (GET /enrollment/consent)
             |
             +--> Jika belum: Tampilkan Modal Persetujuan -> POST /enrollment/consent
             |
        Inisiasi Enrollment (POST /enrollment/initiate) -> Dapatkan enrollmentId
             |
        Loop 5 Pose Wajah (Webcam Canvas Capture):
          1. Tampilkan instruksi visual & overlay panduan
          2. Ambil frame foto (.jpg)
          3. POST /enrollment/poses (multipart: photo, pose, enrollmentId)
          4. Jika AI merespons isValid=true: Lanjut ke pose berikutnya (Motion anim)
          5. Jika gagal: Tampilkan pesan feedback (misal: "Kurang menoleh")
             |
        Finalisasi Enrollment (POST /enrollment/finalize)
             |
        [Selesai] -> Enrollment Aktif & Siap Presensi
```

### Cuplikan Kode Upload Pose (React):
```typescript
const uploadPose = async (enrollmentId: string, pose: string, imageBlob: Blob) => {
  const formData = new FormData();
  formData.append('enrollmentId', enrollmentId);
  formData.append('pose', pose);
  formData.append('photo', imageBlob, `${pose}.jpg`);

  const response = await api.post('/enrollment/poses', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};
```

---

## 5. Alur Integrasi Presensi Mandiri (Face Attendance)

Sebelum membuka kamera presensi, selalu periksa status kesiapan layanan AI:

### A. Pre-flight Check AI Status
```typescript
const checkAi = async () => {
  try {
    const res = await api.get('/attendance/ai-status');
    return res.data.data.healthy; // true / false
  } catch {
    return false;
  }
};
```
Jika `healthy === false`:
- Tampilkan spanduk peringatan: *"Layanan verifikasi wajah otomatis sedang offline. Silakan hubungi monitor untuk presensi manual."*
- Sediakan tombol pintas ke form: `POST /api/v1/attendance/request-help`.

### B. Eksekusi Verifikasi Wajah & Geolocation
```typescript
const submitAttendance = async (sessionId: string, photoBlob: Blob) => {
  // 1. Dapatkan koordinat GPS perangkat
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });

  const { latitude, longitude } = position.coords;

  // 2. Kirim data verifikasi presensi
  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('latitude', latitude.toString());
  formData.append('longitude', longitude.toString());
  formData.append('photo', photoBlob, 'attendance.jpg');

  const res = await api.post('/attendance/verify', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return res.data; // { success: true, message: 'Presensi berhasil diverifikasi' }
};
```

---

## 6. Standar Paginasi & Pencarian Tabel

Untuk endpoint yang mengembalikan daftar data dalam jumlah besar (Daftar Pengguna, Log Audit, Riwayat Pelanggaran):
- Parameter query:
  - `limit`: Jumlah data per halaman (default: `20`, maksimum: `500`).
  - `offset`: Indeks data awal (dimulai dari `0`).
  - `search`: Kata kunci pencarian nama atau NIM (opsional).
- Contoh pemanggilan:
  ```http
  GET /api/v1/residents?limit=25&offset=50&category=ASRAMA_KRISTAL
  GET /api/v1/admin/users?limit=20&offset=0&search=10502
  GET /api/v1/reports/audit-logs?limit=50&offset=100
  ```

---

## 7. Kamus Status Kode HTTP & Penanganan Kesalahan

| Kode HTTP | Skenario Error | Aksi yang Disarankan untuk Frontend |
|---|---|---|
| `200 OK` | Permintaan berhasil diproses. | Perbarui state UI dan tampilkan toast sukses. |
| `201 Created` | Sumber daya baru berhasil dibuat. | Navigasikan pengguna atau tutup modal formulir. |
| `400 Bad Request` | Validasi input gagal, format salah, atau di luar geofence. | Tampilkan pesan error spesifik pada field formulir terkait. |
| `401 Unauthorized` | Token kedaluwarsa, tidak ada token, atau akun dinonaktifkan. | Coba refresh token; jika gagal, redirect ke halaman `/login`. |
| `403 Forbidden` | Role tidak memiliki hak akses ke endpoint tersebut. | Tampilkan halaman *Access Denied* atau sembunyikan navigasi. |
| `404 Not Found` | Data atau sesi presensi tidak ditemukan. | Tampilkan kartu *Data Not Found* / *Empty State*. |
| `409 Conflict` | Duplikasi data (misal: sudah absen pada sesi ini, atau NIM sudah dipakai). | Tampilkan modal konfirmasi atau peringatan duplikasi. |
| `503 Service Unavailable` | Layanan AI FastAPI atau Database sedang tidak merespons. | Tampilkan pesan fallback dan tawarkan opsi presensi manual / minta bantuan. |

---

## 8. Panduan Animasi UI/UX dengan Motion

Gunakan pustaka `@motiondivision/motion` (atau `motion/react`) untuk memberikan umpan balik visual yang responsif:
- **Liveness Pulse:** Lingkaran animasi berdenyut lembut pada viewfinder kamera saat mendeteksi wajah aktif.
- **Stepper Transisi Pose:** Animasi slide horizontal halus antar-pose (misal dari Frontal ke Menoleh Kanan) untuk mengarahkan pengguna secara natural.
- **Success Checkmark:** Animasi path SVG centang hijau saat presensi berhasil tercatat.
