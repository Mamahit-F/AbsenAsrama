# DOKUMENTASI INTEGRASI AI (FASTAPI & BIOMETRIC RECOGNITION)

Dokumen ini menjelaskan arsitektur integrasi, kontrak antarmuka HTTP, parameter penalaan, dan penanganan kegagalan (*fault-tolerance*) antara Spring Boot Backend dan Python FastAPI AI Microservice.

---

## 1. Arsitektur Komunikasi Sistem AI

```
+-------------------------------------------------------------------------+
|                              FRONTEND REACT                             |
|  - Kamera HTML5 Canvas / WebRTC Stream                                  |
|  - Panduan Pose Interaktif (Frontal, Kanan, Kiri, Atas, Bawah)          |
|  - Capture Frame Base64 / Multipart                                     |
+-------------------------------------------------------------------------+
                                     |
                                     | HTTP POST (Multipart/JSON)
                                     v
+-------------------------------------------------------------------------+
|                           SPRING BOOT BACKEND                           |
|  - Validasi Sesi & Konteks Keamanan Pengguna                            |
|  - Validasi Magic Bytes & Sanitasi Berkas Foto                          |
|  - Orchestrator Alur Bisnis (Enrollment, Verifikasi Sesi, Logging)      |
|  - FastApiAiClient (HTTP RestClient dengan Timeout & Health Check)      |
+-------------------------------------------------------------------------+
           |                                              |
           | HTTP REST (Port 8000)                        | SQL (pgvector cosine)
           v                                              v
+------------------------------------+   +--------------------------------+
|      PYTHON FASTAPI AI SERVICE     |   |      SUPABASE POSTGRESQL       |
|  - MediaPipe / InsightFace         |   |  - Tabel resident_face_embeddings
|  - MiniFASNet (Anti-Spoofing/PAD)  |   |  - Index IVFFlat / HNSW        |
|  - ArcFace ResNet50 (Embedding 512)|   |  - Operator <=> (Cosine Dist)  |
|  - Quality Check (Blur, Brightness)|   |  - Cosine Similarity Matching  |
+------------------------------------+   +--------------------------------+
```

---

## 2. Prinsip Integritas & Tanpa Mock (Zero-Mock Policy)

Sesuai standar produksi:
1. **Tidak Ada Mock di Kode Produksi:** Spring Boot `FastApiAiClient` memanggil endpoint HTTP nyata dari layanan FastAPI. Tidak ada pengembalian data palsu (*fake/hardcoded embeddings*) di kelas produksi.
2. **Fail-Safe Mechanism:** Jika microservice FastAPI tidak aktif, tidak merespons, atau mengalami *timeout*, sistem secara eksplisit menolak transaksi dan melemparkan `AiServiceUnavailableException` (HTTP 503 Service Unavailable) dengan pesan yang jelas kepada pengguna.
3. **Pemisahan Peran Komputasi:**
   - **FastAPI:** Bertanggung jawab atas inferensi citra (liveness, pose check, ekstraksi vektor 512-dimensi).
   - **Spring Boot & PostgreSQL:** Bertanggung jawab atas perbandingan vektor (*cosine similarity matching*), integritas jadwal, aturan sesi, otorisasi, dan pencatatan riwayat.

---

## 3. Spesifikasi Kontrak HTTP FastAPI Aktual (Spring Boot FastApiAiClient)

Layanan FastAPI dikonfigurasi melalui properti pada Spring Boot (`application.yml`):
```properties
app.ai.base-url=http://localhost:8000
app.ai.api-key=dev-ai-internal-key
app.ai.connect-timeout-ms=1000
app.ai.read-timeout-ms=2200
```
Header wajib dikirimkan oleh Spring Boot ke setiap endpoint FastAPI:
`X-Internal-API-Key: ${app.ai.api-key}`

> [!IMPORTANT]
> **Sinkronisasi Rute Endpoint:**
> Kode Java `FastApiAiClient.java` memanggil rute ber-prefix `/api/v1/ai/...`. Agar microservice FastAPI kompatibel baik saat diakses Spring Boot maupun alat diagnostik, FastAPI disarankan mendefinisikan rute kanonikal di bawah APIRouter `/api/v1/ai` serta menyediakan alias route level root.

### A. Health Check Probe
- **Endpoint:** `GET /health`
- **Tujuan:** Memeriksa kesiapan AI service, model neural network di memori, dan ketersediaan GPU/CPU.
- **Respons Sukses (HTTP 200 OK):**
  ```json
  {
    "status": "HEALTHY",
    "version": "1.0.0",
    "modelsLoaded": {
      "faceDetection": true,
      "livenessMiniFASNet": true,
      "arcFaceEmbedding": true
    },
    "device": "cuda:0"
  }
  ```

### B. Validasi Pose Wajah (Enrollment)
- **Endpoint Utama:** `POST /api/v1/ai/enrollment/validate-pose` (Alias: `POST /validate-pose`)
- **Tujuan:** Memastikan pose foto wajah sesuai dengan tahap enrollment yang diminta (5 pose: `LURUS`, `KANAN`, `KIRI`, `ATAS`, `BAWAH`), mengecek kualitas (pencahayaan & ketajaman), dan memverifikasi keaslian (liveness / anti-spoofing).
- **Request Body (JSON):**
  ```json
  {
    "residentId": "b112ba89-35a2-4c74-9f4a-69acbcc6629e",
    "enrollmentId": "e0abc291-e34c-4869-912f-50481326650f",
    "expectedPose": "LURUS",
    "imageBase64": "/9j/4AAQSkZJRg..."
  }
  ```
- **Respons Sukses (HTTP 200 OK):**
  ```json
  {
    "faceDetected": true,
    "faceCount": 1,
    "poseMatched": true,
    "detectedPose": "LURUS",
    "qualityScore": 0.88,
    "qualityPassed": true,
    "livenessScore": 0.94,
    "livenessPassed": true,
    "qualityDetails": {
      "blurScore": 142.5,
      "brightnessScore": 115.0
    },
    "rejectionReason": null,
    "processingTimeMs": 62
  }
  ```
- **Respons Gagal Validasi (HTTP 200 OK dengan `poseMatched: false` atau `qualityPassed: false`):**
  ```json
  {
    "faceDetected": true,
    "faceCount": 1,
    "poseMatched": false,
    "detectedPose": "KIRI",
    "qualityScore": 0.40,
    "qualityPassed": false,
    "livenessScore": 0.90,
    "livenessPassed": true,
    "qualityDetails": {
      "blurScore": 32.1
    },
    "rejectionReason": "Pose terdeteksi KIRI padahal diharapkan LURUS, dan gambar buram",
    "processingTimeMs": 55
  }
  ```

### C. Ekstraksi Vektor Fitur 5 Pose (ArcFace 512-d)
- **Endpoint Utama:** `POST /api/v1/ai/enrollment/extract-embedding` (Alias: `POST /extract-embedding`)
- **Tujuan:** Menggabungkan representasi fitur wajah dari 5 citra pose enrollment menjadi 1 vektor representasi ArcFace 512-dimensi ternormalisasi ($L_2$ norm = 1.0).
- **Request Body (JSON):**
  ```json
  {
    "residentId": "b112ba89-35a2-4c74-9f4a-69acbcc6629e",
    "enrollmentId": "e0abc291-e34c-4869-912f-50481326650f",
    "poseImagesBase64": {
      "LURUS": "/9j/4AAQSkZJRg...",
      "KANAN": "/9j/4AAQSkZJRg...",
      "KIRI": "/9j/4AAQSkZJRg...",
      "ATAS": "/9j/4AAQSkZJRg...",
      "BAWAH": "/9j/4AAQSkZJRg..."
    }
  }
  ```
- **Respons Sukses (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "embedding512": [0.02451, -0.01893, 0.05122, ..., -0.00318],
    "modelVersion": "ArcFace-r100",
    "qualitySummary": {
      "averageQuality": 0.89,
      "averageLiveness": 0.95
    },
    "failureReason": null,
    "processingTimeMs": 210
  }
  ```

### D. Analisis Frame Presensi (Liveness + Quality + Embedding Sekaligus)
- **Endpoint Utama:** `POST /api/v1/ai/attendance/analyze-frame` (Alias: `POST /analyze-frame`)
- **Tujuan:** Verifikasi citra presensi resident: mendeteksi wajah, memeriksa liveness (MiniFASNet anti-spoofing), memeriksa kualitas, dan mengekstraksi vektor 512-d untuk dicocokkan dengan pgvector.
- **Request Body (JSON):**
  ```json
  {
    "sessionId": "4638aaa0-f4da-495f-8477-27a272f7950a",
    "residentId": "b112ba89-35a2-4c74-9f4a-69acbcc6629e",
    "imageBase64": "/9j/4AAQSkZJRg..."
  }
  ```
- **Respons Sukses (HTTP 200 OK):**
  ```json
  {
    "faceDetected": true,
    "faceCount": 1,
    "livenessScore": 0.963,
    "livenessPassed": true,
    "qualityScore": 0.884,
    "embedding512": [0.02412, -0.01855, ..., -0.00312],
    "modelVersion": "ArcFace-r100",
    "rejectionReason": null,
    "processingTimeMs": 85
  }
  ```
- **Respons Terdeteksi Serangan Spoofing (HTTP 200 OK dengan `livenessPassed: false`):**
  ```json
  {
    "faceDetected": true,
    "faceCount": 1,
    "livenessScore": 0.231,
    "livenessPassed": false,
    "qualityScore": 0.750,
    "embedding512": null,
    "modelVersion": "ArcFace-r100",
    "rejectionReason": "Liveness check gagal: terdeteksi presentasi serangan layar/cetak fisik (Presentation Attack)",
    "processingTimeMs": 70
  }
  ```
  {
    "isLive": true,
    "livenessScore": 0.963,
    "qualityScore": 88.4,
    "embedding": [
      0.02412, -0.01855, ..., -0.00312
    ],
    "rejectionReason": null
  }
  ```
- **Respons Terdeteksi Spoofing (HTTP 200 OK dengan `isLive: false`):**
  ```json
  {
    "isLive": false,
    "livenessScore": 0.231,
    "qualityScore": 75.0,
    "embedding": null,
    "rejectionReason": "Liveness check gagal: terdeteksi citra layar/cetak digital (Presentation Attack)"
  }
  ```

---

## 4. Alur Evaluasi Liveness-First pada Presensi

Backend mematuhi hierarki keputusan yang aman:
1. **Liveness Evaluation:** Liveness score wajib $\ge 0.85$. Jika di bawah nilai ini, proses verifikasi dihentikan seketika dan dicatat ke `validation_logs` dengan status `REJECTED_SPOOF`.
2. **Quality Evaluation:** Citra tidak boleh buram (*Laplacian variance* $\ge 50.0$) dan pencahayaan tidak boleh ekstrim.
3. **Vector Comparison di PostgreSQL:**
   - Backend memanggil query PostgreSQL menggunakan operator `<=>` (cosine distance):
     ```sql
     SELECT resident_id, (1 - (embedding <=> :queryEmbedding::vector)) AS similarity
     FROM resident_face_embeddings
     WHERE resident_id = :residentId AND is_active = TRUE
     ORDER BY embedding <=> :queryEmbedding::vector ASC
     LIMIT 1;
     ```
4. **Threshold Matching:**
   - Jika `similarity >= 0.70`: Presensi diterima (`VERIFIED`).
   - Jika `similarity < 0.70`: Presensi ditolak (`FACE_MISMATCH`).

---

## 5. Strategi Fallback Presensi Manual

Jika terjadi kendala teknis pada perangkat resident atau layanan AI:
1. **Request Bantuan:** Resident mengajukan tiket bantuan melalui `POST /api/v1/attendance/request-help` dengan menyertakan alasan kendala (misal: "Kamera rusak", "Pencahayaan asrama padam").
2. **Verifikasi oleh Monitor/Admin:**
   - Monitor asrama memeriksa identitas fisik resident di pos jaga.
   - Monitor memanggil endpoint `POST /api/v1/attendance/manual-verify` dengan menyertakan:
     - `residentId`
     - `sessionId`
     - `verificationMethod`: `MANUAL` atau `GUARD_ASSISTED`
     - `notes`: Catatan alasan verifikasi manual
3. **Audit Trail:** Presensi manual diberi bendera khusus dan dicatat dalam riwayat audit agar dapat diverifikasi oleh Village Dean.
