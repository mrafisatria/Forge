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

Atau buat Edge Function bernama **forge-api** di dashboard, masukkan seluruh berkas dari folder **supabase/functions/forge-api**, lalu deploy. Verifikasi JWT bawaan dimatikan **hanya untuk forge-api** karena fungsi ini memeriksa token sesi Forge sendiri. Jangan mengubah dompetku-api.

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

Hitung mundur menggunakan waktu selesai absolut. Saat Forge terlihat, alarm berbunyi sampai bulatan ditekan. Saat minimize, semua audio timer dihentikan; tidak ada audio senyap atau mode playback latar belakang yang mengambil alih Spotify. Timer yang selesai saat tersembunyi tidak memutar alarm terlambat ketika Forge dibuka lagi.

### Notifikasi saat minimize

Jalankan **supabase/migrations/20260903_timer_notifications.sql** lalu **supabase/migrations/20260903_timer_claim_retry.sql** sekali, kemudian deploy ulang **forge-api** sebelum menerbitkan frontend. Migrasi membuat tiga tabel Forge privat, RPC yang hanya bisa diakses server, dan dua job Cron bernama `forge-timer-notifications` serta `forge-timer-notification-cleanup`. Tidak mengubah data atau job aplikasi lain. URL dispatcher dalam migrasi mengarah ke proyek Supabase Forge yang sekarang; ubah URL tersebut jika memasang pada proyek lain. Uji transaksi administratif di **supabase/tests/timer_notifications.sql** memeriksa cancellation, presence, claim, retry, serta logout dan membatalkan semua data uji melalui rollback.

Kunci VAPID dibuat sekali di server ketika konfigurasi notifikasi pertama kali diminta akun Rafi. Kunci privat dan secret dispatcher disimpan pada tabel `forge_push_settings` yang tidak dapat dibaca anon/authenticated. Hanya kunci publik dikirim ke frontend; tidak membutuhkan variable Vercel baru. Pengiriman dienkripsi dengan Web Push dan dibatasi ke layanan push Apple, Google, dan Mozilla, tanpa mengikuti redirect.

Di panel timer, tekan **Aktifkan notifikasi** dan izinkan permintaan browser. Di iPhone gunakan Forge dari Home Screen (iOS 16.4+); bila shortcut lama masih membuka tab browser biasa, tambahkan ulang dari Safari setelah pembaruan ini. Pilih preset dan tunggu pesan penjadwalan selesai sebelum minimize. Tombol **Nonaktifkan notifikasi** membatalkan langganan perangkat ini. Izin tidak diminta otomatis.

Deadline dicatat ke Supabase saat timer dimulai. Cron memeriksa setiap lima detik tetapi hanya memanggil Edge Function saat ada timer yang jatuh tempo. Kehadiran halaman diperbarui setiap lima detik saat terlihat; timer yang selesai di foreground membatalkan notifikasi. Ada grace period dua detik dan expiry kehadiran 12 detik agar minim duplikasi. Penggantian/pembatalan bersifat idempoten; cancel yang tiba sebelum start tidak menghidupkan kembali timer. Keluar akun mencabut sesi dan menghapus langganan terkait melalui foreign key. Timer di perangkat lain tidak dibatalkan.

Notifikasi hanya berisi pengingat umum, menggunakan `silent: true`, dan membuka Forge saat ditekan. Tidak memutar alarm atau menyimpan halaman, token login, dan media pribadi di service worker. Notifikasi tetap bergantung pada internet, dukungan browser, izin dan Focus; pengiriman bisa terlambat dan bukan jaminan alarm tepat detik. Bila start/cancel gagal, UI memberi peringatan. Pengiriman dibatasi tiga percobaan dalam dua menit, TTL push 60 detik, dan satu tag per timer. Catatan timer dibersihkan setelah tujuh hari, log Cron Forge setelah satu hari. Refresh menghilangkan hitung mundur lokal; jadwal yang sudah diterima server tetap dapat mengirim notifikasi.

Referensi: [Web Push untuk Home Screen iPhone](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Supabase Cron](https://supabase.com/docs/guides/cron), [Web Push library](https://github.com/web-push-libs/web-push).

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

**scripts/check-live-push.mjs** memeriksa konfigurasi VAPID, jadwal/pembatalan, isolasi perangkat, dan izin tabel melalui API nyata. Secret juga dibaca dari stdin. Skrip membuat perangkat dan timer sementara, membatalkan timer sebelum jatuh tempo, kemudian membersihkan perangkat serta sesi uji; tidak mengirim push nyata. Pengiriman ke iPhone perlu diuji pada perangkat setelah pengguna mengizinkan notifikasi.

Foto yang diganti/dihapus dari routine tidak otomatis dihapus dari Storage untuk menghindari kehilangan foto saat ada kegagalan penyimpanan; bersihkan file yatim lewat administrasi bila diperlukan.
