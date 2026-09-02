# Forge Gym Tracker

Gym tracker Next.js untuk routine, exercise, foto, set, beban KG (termasuk koma desimal), dan reps. Database: Supabase project **Lutu**, sama dengan Dompetku; data serta login Forge tetap terpisah.

## Login dan keamanan

- Hanya **satu akun Rafi**, dibatasi juga oleh constraint database. Tidak ada pendaftaran atau login email.
- Pola login seperti Dompetku: secret key diverifikasi bcrypt di server, token acak 256-bit berlaku 30 hari, hanya hash token yang disimpan di database.
- Secret akun tidak disimpan di source, GitHub, atau variable frontend.
- Sesi dan akun Forge menggunakan tabel sendiri; token Dompetku tidak diterima.
- Pembatas percobaan atomik: 8 per alamat IP / 15 menit dan 40 total / 15 menit. Secret pendek tetap lebih mudah ditebak; gunakan secret panjang dan unik bila memungkinkan.
- RLS aktif; anon dan authenticated tidak memiliki izin tabel maupun RPC. Semua operasi melalui Edge Function yang memverifikasi sesi serta kepemilikan.
- Foto JPEG/PNG/WebP maksimal 5 MB, disimpan di bucket privat. Link foto sementara berlaku satu jam; aplikasi menyegarkannya secara berkala.
- Browser hanya menyimpan token sesi, bukan salinan database. Jika Supabase belum dikonfigurasi, login dinonaktifkan; tidak ada mode demo yang seolah menyimpan data.

## Fitur Workout

Buat routine kosong, edit nama/hari/catatan melalui tombol pensil, tambah exercise melalui Add exercise, lalu edit langsung atau hapus exercise melalui menu tiga titik. Input mobile berukuran minimal 16 px agar fokus tidak memicu zoom iOS.

## Setup Supabase

1. Jalankan **supabase/schema.sql** di SQL Editor proyek tujuan. Skrip ini untuk instalasi Forge baru, bukan migrasi dari versi Supabase Auth lama. Tidak mengubah tabel Dompetku.
2. Buat hash bcrypt secret akun secara lokal memakai **scripts/hash-account-secret.mjs** (membaca dari stdin). Jangan menyimpan secret maupun hash di repository.
3. Melalui SQL Editor administratif, masukkan hash untuk akun Rafi:

~~~sql
insert into public.forge_accounts (name, secret_hash)
values ('Rafi', '<BCRYPT_HASH>');
~~~

Jangan jalankan dengan placeholder. Constraint singleton menolak akun kedua. Untuk mengganti secret, perbarui hash melalui administrasi dan cabut sesi Forge yang lama.

4. Deploy folder **supabase/functions/forge-api**:

~~~sh
supabase functions deploy forge-api --project-ref mriotylczlxaxydhorga --no-verify-jwt
~~~

Atau buat Edge Function bernama **forge-api** di dashboard, masukkan **index.ts**, **handler.ts**, **validation.ts**, dan **deno.json**, lalu deploy. Verifikasi JWT bawaan dimatikan **hanya untuk forge-api** karena fungsi ini memeriksa token sesi Forge sendiri. Jangan mengubah dompetku-api.

Server menggunakan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEYS bawaan Edge Functions. Jangan menyalin key server ke frontend.

Tabel baru: forge_accounts, forge_sessions, forge_login_attempts, gym_routines, gym_exercises, gym_exercise_sets. Bucket: forge-exercise-images (privat).

Dokumentasi resmi: [konfigurasi Edge Functions](https://supabase.com/docs/guides/functions/function-configuration), [bucket privat](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Lokal dan Vercel

Isi **.env.local** (diabaikan Git) dengan:

~~~env
NEXT_PUBLIC_SUPABASE_URL=https://mriotylczlxaxydhorga.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_OR_ANON_KEY>
~~~

Nama ANON_KEY juga menerima publishable key. Jangan memasukkan service_role/secret API key ke variable NEXT_PUBLIC_*.

~~~sh
npm install
npm run dev
~~~

Di Vercel, import repository Forge sebagai Next.js, tambahkan kedua variable di **Project Settings → Environment Variables**, lalu redeploy. Env lokal tidak otomatis dikirim ke Vercel. Frontend Vercel dan Edge Function Supabase adalah dua deployment terpisah.

## Pemeriksaan

~~~sh
npm test
npm run typecheck:api
npm run lint
npm run build
~~~

Test lokal memakai backend tiruan: autentikasi Rafi, pembatas login, isolasi sesi/owner, logout, validasi data dan foto. Tetap periksa koneksi nyata setelah schema dan Edge Function terpasang.

Foto yang diganti/dihapus dari routine tidak otomatis dihapus dari Storage untuk menghindari kehilangan foto saat ada kegagalan penyimpanan; bersihkan file yatim lewat administrasi bila diperlukan.
