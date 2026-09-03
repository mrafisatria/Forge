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

Daftar routine otomatis diurutkan Senin sampai Minggu. Routine tanpa hari atau dengan hari kustom lama berada paling bawah; urutan antar-routine pada hari yang sama tetap dipertahankan.

Tekan gambar atau video pada exercise untuk melihatnya lebih besar dalam popup. Tutup melalui tombol ×, area di luar popup, atau Esc. Video memiliki kontrol putar dan tetap mengikuti preferensi pengurangan gerakan perangkat.

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

Untuk editor dashboard yang lebih praktis, jalankan **npm run bundle:edge**. Salin hasil **outputs/forge-api/index.ts** menjadi berkas utama **index.ts** di editor. Bundle ini dibuat dari source yang sama dan tidak memuat secret akun atau key server.

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

## Timer istirahat

Tombol melayang di tepi layar membuka preset **1:00, 1:30, 2:00, 3:00, dan 4:00**. Pilih durasi untuk langsung memulai dan menutup panel; sisa waktu tampil di bulatan. Alarm berulang saat habis dan berhenti saat bulatan ditekan. Ketika sedang menghitung, tekan bulatan untuk mengganti durasi atau membatalkan timer. Bulatan dapat digeser dan menempel ke sisi layar.

Timer berjalan lokal selama sesi halaman (tidak disimpan ke database atau dipertahankan setelah refresh/logout), dan tidak hilang saat berpindah routine atau membuka galeri. Hitung mundur menggunakan waktu selesai absolut agar tidak melambat karena tab berada di belakang. Suara diaktifkan dari klik preset; timer menampilkan peringatan bila browser menolak audio. Tidak meminta izin notifikasi OS.

Pada browser yang mendukung `navigator.audioSession`, timer memakai mode `playback` dan langsung memutar buffer berisi jeda senyap, disusul nada yang berulang. Dengan begitu, nada tidak menunggu JavaScript halaman aktif kembali saat Forge di-minimize. Hanya bagian nada yang diulang; buffer mono 8 kHz untuk preset terlama memakai kurang dari 8 MB. Mode audio sebelumnya dipulihkan saat timer dihentikan. Browser tanpa API ini tetap memakai alarm halaman biasa.

Aktifkan volume dan jangan tutup paksa Forge. Dukungan latar belakang tetap bergantung pada iOS/browser; telepon, audio aplikasi lain, atau penghentian aplikasi oleh OS dapat menginterupsi alarm. Mode playback juga dapat menjeda musik dari aplikasi lain. Ini bukan pengganti alarm native iPhone dan perlu diuji langsung di perangkat, termasuk saat minimize/layar terkunci. Lihat [AudioSession playback](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type), [pengujian background Web Audio oleh WebKit](https://github.com/WebKit/WebKit/blob/main/LayoutTests/media/webaudio-background-playback.html), dan [aturan aktivasi audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

## Galeri media exercise

- Buka menu **Galeri media** tepat di bawah **Workout** untuk upload hingga 20 file sekali pilih. Hasil setiap file ditampilkan; tombol coba ulang hanya mengunggah file yang gagal.
- Gambar: JPEG, PNG, WebP, maksimal 5 MB per file. Video: MP4 standar, maksimal 10 detik dan 10 MB; MP4 H.264 direkomendasikan untuk kompatibilitas browser. Video tidak dipotong otomatis. Durasi diperiksa di browser dan di server dari header MP4, termasuk durasi track; fragmented MP4 tidak didukung.
- Klik **Pilih media** saat membuat/mengedit exercise. Satu media dapat dipakai pada beberapa routine tanpa menyalin file. **Lepas media** hanya menghapus pilihan pada exercise, bukan file di galeri.
- Upload identik dideteksi berdasarkan hash konten agar retry tidak menggandakan file. Media tetap privat di bucket `forge-exercise-images`; metadata dan pemilik ada di `forge_media`. Tautan tampilan ditandatangani selama satu jam dan diperbarui berkala.
- Untuk database lama, jalankan **supabase/migrations/20260903_media_library.sql**, lalu **supabase/migrations/20260903_video_duration_10_seconds.sql**, kemudian deploy ulang **forge-api** sebelum frontend. Jika galeri sudah terpasang, cukup jalankan migration durasi 10 detik. Migration mendaftarkan foto lama ke galeri tanpa memindahkan/menghapus file dan tidak mengubah data Dompetku. Instalasi baru cukup memakai schema terbaru.

## Logo dan favicon

Logo utama ada di **public/favicon.svg**. Jalankan **npm run generate:icons** setelah mengubahnya untuk memperbarui favicon ICO (16/32/48 px), ikon iPhone (180 px), dan **public/forge-logo.png** (512 px) untuk avatar project Vercel. File hasilnya ikut disimpan di Git. Next.js memasang favicon ICO secara otomatis; metadata memasang versi SVG dan Apple icon.

## Pemeriksaan

~~~sh
npm test
npm run typecheck:api
npm run lint
npm run build
~~~

Test lokal memakai backend tiruan: autentikasi Rafi, pembatas login, isolasi sesi/owner, logout, validasi data dan foto. Tetap periksa koneksi nyata setelah schema dan Edge Function terpasang.

**scripts/check-live-api.mjs** tersedia untuk pemeriksaan koneksi nyata. Jalankan dengan environment lokal dan masukkan secret lewat stdin (jangan lewat argumen perintah yang disimpan). Skrip ini membuat satu routine sementara, memeriksa penyimpanan dan akses, kemudian menghapus routine tersebut serta mencabut sesi uji. Jangan menjalankannya sebagai pemeriksaan read-only.

Foto yang diganti/dihapus dari routine tidak otomatis dihapus dari Storage untuk menghindari kehilangan foto saat ada kegagalan penyimpanan; bersihkan file yatim lewat administrasi bila diperlukan.
