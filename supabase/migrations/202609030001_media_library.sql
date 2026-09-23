begin;
create table if not exists public.forge_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.forge_accounts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  image_path text not null unique,
  kind text not null check (kind in ('image', 'video')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  duration_seconds double precision,
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(user_id, content_hash),
  check ((kind = 'image' and duration_seconds is null) or (kind = 'video' and duration_seconds > 0 and duration_seconds <= 3)),
  check (split_part(image_path, '/', 1) = user_id::text)
);
create index if not exists forge_media_user_created_idx on public.forge_media(user_id, created_at desc, id);
alter table public.forge_media enable row level security;
revoke all on public.forge_media from public, anon, authenticated;
grant select, insert, update, delete on public.forge_media to service_role;

-- Register earlier uploads without moving or deleting any existing files.
insert into public.forge_media(user_id, name, image_path, kind, mime_type, size_bytes, created_at)
select a.id,
  left(coalesce((select e.name from public.gym_exercises e where e.image_path = o.name and e.user_id = a.id limit 1), 'Foto exercise'), 180),
  o.name, 'image',
  case when o.name like '%.jpg' then 'image/jpeg' when o.name like '%.png' then 'image/png' else 'image/webp' end,
  (o.metadata->>'size')::bigint, o.created_at
from storage.objects o join public.forge_accounts a on split_part(o.name, '/', 1) = a.id::text
where o.bucket_id = 'forge-exercise-images'
  and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  and (o.metadata->>'size')::bigint between 1 and 5242880
on conflict(image_path) do nothing;

update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
where id = 'forge-exercise-images';
commit;
