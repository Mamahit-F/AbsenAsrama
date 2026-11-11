# DATABASE MIGRATIONS

Daftar berurutan file migration pada `database/migrations/`:

1. [`V001_initial_schema.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/migrations/V001_initial_schema.sql) — Struktur dasar 12 tabel V1 dan tipe ENUM awal.
2. [`V002_types_extensions.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/migrations/V002_types_extensions.sql) — Ekstensi `postgis` & `btree_gist`, penambahan nilai ENUM `VILLAGE_DEAN`, tipe ENUM tambahan, dan zona waktu `Asia/Makassar`.
3. [`V003_core_extensions.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/migrations/V003_core_extensions.sql) — Penambahan kolom pada tabel utama, indeks HNSW `pgvector`, kolom `geom` PostGIS, tabel `face_profile_history`, dan constraint GiST anti-tumpang-tindih sesi.
4. [`V004_new_tables.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/migrations/V004_new_tables.sql) — Pembuatan tabel pendukung kegiatan, pengecualian/libur, pelanggaran, evaluasi, pembinaan, kontak darurat, dan permintaan bantuan.
5. [`V005_functions_triggers_seed.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/migrations/V005_functions_triggers_seed.sql) — Fungsi konteks JWT Spring Boot, fungsi autentikasi/lockout, fungsi & trigger domain, trigger audit/imutabilitas, dan seed konfigurasi awal.
6. [`V006_security_roles_rls_storage.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/migrations/V006_security_roles_rls_storage.sql) — Role `app_backend`, pencabutan privilege `PUBLIC`/`anon`/`authenticated`, covering index seluruh FK, 84 policy RLS `public`, dan 4 policy RLS `storage.objects`.

Paket gabungan siap pakai tersedia pada:
- [`database/final/FINAL_DATABASE_SETUP.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/final/FINAL_DATABASE_SETUP.sql)
- [`database/final/FINAL_DATABASE_VERIFICATION.sql`](file:///d:/from%20c/Documents/holyyy/SoftwareEngineering/Absenasrama/database/final/FINAL_DATABASE_VERIFICATION.sql)
