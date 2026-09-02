# Forge Gym Tracker

Forge adalah gym tracker responsif untuk membuat routine, menambahkan exercise beserta foto, dan mencatat set, berat (kg), serta repetisi. Aplikasi memakai Supabase Auth, Postgres, Row Level Security, dan Supabase Storage.

## Fitur saat ini

- Daftar dan login akun dengan Supabase Auth.
- Membuat, melihat, mengubah, dan menghapus routine.
- Beberapa exercise di dalam satu routine.
- Foto exercise dengan upload maksimal 5 MB (JPEG, PNG, atau WebP).
- Set dinamis dengan nilai kg dan reps.
- Mode workout sederhana untuk mencentang set yang selesai.
- Tampilan responsif untuk desktop dan ponsel.
- Data setiap pengguna dipisahkan dengan Row Level Security.

## Menyiapkan Supabase

1. Buka Supabase project yang ingin dipakai. Project yang sama dengan Dompetku juga boleh digunakan karena tabel Forge memakai prefix `gym_` dan bucket tersendiri.
2. Jalankan seluruh isi [`supabase/schema.sql`](supabase/schema.sql) melalui **SQL Editor**.
3. Di **Authentication → Providers → Email**, aktifkan Email provider. Untuk penggunaan pribadi, konfirmasi email bisa dimatikan bila diinginkan.
4. Salin `.env.example` menjadi `.env.local`, lalu isi URL project dan publishable/anon key:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-KEY
```

Jangan memasukkan `service_role` atau secret key ke variable `NEXT_PUBLIC_*`.

Tanpa environment variable, aplikasi otomatis berjalan dalam mode demo. Perubahan mode demo hanya bertahan selama halaman masih terbuka dan tidak dikirim ke database.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Deploy ke Vercel

1. Import repository ini ke Vercel.
2. Framework akan terdeteksi sebagai **Next.js**.
3. Tambahkan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` di **Project Settings → Environment Variables** untuk Production, Preview, dan Development.
4. Deploy ulang setelah environment variable tersimpan.

Tidak ada secret server-side yang diperlukan oleh frontend.
