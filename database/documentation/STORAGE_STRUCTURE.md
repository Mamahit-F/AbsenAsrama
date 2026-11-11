# SUPABASE STORAGE STRUCTURE — FACE ENROLLMENT

## 1. Konfigurasi Bucket

| Properti | Nilai |
|---|---|
| Nama Bucket Utama | `face-enrollments` (serta alias kompatibilitas `face-enrollment`) |
| Visibilitas | **PRIVATE (`public = false`)** |
| Batas Ukuran File | `5.242.880` bytes (5 MB) |
| MIME Types Diizinkan | `image/jpeg`, `image/png`, `image/webp` |

## 2. Struktur Path Objek

```text
face-enrollments/
└── {resident_id}/
    └── {enrollment_id}/
        ├── front.jpg   (pose: LURUS)
        ├── left.jpg    (pose: KIRI)
        ├── right.jpg   (pose: KANAN)
        ├── up.jpg      (pose: ATAS)
        └── down.jpg    (pose: BAWAH)
```

## 3. Penegakan Integritas Path & Akses

1. **Validasi Regex & Trigger Database:**
   - Constraint `photo_path_format` dan trigger `trg_validate_enrollment_photo` pada `public.enrollment_photos` memastikan `storage_path` cocok persis dengan `{resident_id}/{enrollment_id}/{front|left|right|up|down}.jpg` sesuai pose dan pemilik enrollment.
2. **Storage RLS Policies (`storage.objects`):**
   - `storage_face_select`: Hanya mengizinkan `ADMIN`, `MONITOR`, atau `PENGHUNI` pemilik folder (`(storage.foldername(name))[1] = public.current_app_resident_id()::text`).
   - `storage_face_insert` & `storage_face_update`: Hanya mengizinkan `ADMIN` atau `PENGHUNI` pemilik folder dengan format nama file yang lolos regex UUID + pose.
   - `storage_face_del`: Hanya mengizinkan `ADMIN`.
