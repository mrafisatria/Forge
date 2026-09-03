-- Forge uses isolated login and workout tables inside Lutu.
-- Never modifies Dompetku's app_users, app_sessions, or transactions.
-- Provision the one account separately with a bcrypt hash (never commit it).
begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.forge_accounts (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  name text not null default 'Rafi' check (name = 'Rafi'),
  secret_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.forge_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references public.forge_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists forge_sessions_account_idx on public.forge_sessions(account_id, expires_at);
create index if not exists forge_sessions_expiry_idx on public.forge_sessions(expires_at);

create table if not exists public.forge_login_attempts (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  attempts integer not null check (attempts >= 0),
  window_started_at timestamptz not null default now()
);
create table if not exists public.gym_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.forge_accounts(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  training_day text check (char_length(training_day) <= 40),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, user_id)
);
create table if not exists public.gym_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null,
  user_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  image_path text,
  sort_order integer not null default 0 check (sort_order >= 0),
  unique(id, user_id),
  foreign key(routine_id, user_id) references public.gym_routines(id, user_id) on delete cascade
);
create table if not exists public.gym_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null,
  user_id uuid not null,
  set_number integer not null check (set_number between 1 and 100),
  weight_kg numeric(8,2) not null default 0 check (weight_kg >= 0),
  reps integer not null default 0 check (reps between 0 and 10000),
  unique(exercise_id, set_number),
  foreign key(exercise_id, user_id) references public.gym_exercises(id, user_id) on delete cascade
);
create index if not exists gym_routines_user_idx on public.gym_routines(user_id, created_at desc);
create index if not exists gym_exercises_routine_idx on public.gym_exercises(routine_id, sort_order);
create index if not exists gym_exercise_sets_exercise_idx on public.gym_exercise_sets(exercise_id, set_number);

-- No direct access from browsers, even with a Supabase Auth session.
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
  constraint forge_media_duration_check check ((kind = 'image' and duration_seconds is null) or (kind = 'video' and duration_seconds > 0 and duration_seconds <= 10)),
  check (split_part(image_path, '/', 1) = user_id::text)
);
create index if not exists forge_media_user_created_idx on public.forge_media(user_id, created_at desc, id);
alter table public.forge_media enable row level security;
revoke all on public.forge_media from public, anon, authenticated;
grant select, insert, update, delete on public.forge_media to service_role;

alter table public.forge_accounts enable row level security;
alter table public.forge_sessions enable row level security;
alter table public.forge_login_attempts enable row level security;
alter table public.gym_routines enable row level security;
alter table public.gym_exercises enable row level security;
alter table public.gym_exercise_sets enable row level security;
revoke all on public.forge_accounts, public.forge_sessions, public.forge_login_attempts,
  public.gym_routines, public.gym_exercises, public.gym_exercise_sets from public, anon, authenticated;
grant select, insert, update, delete on public.forge_accounts, public.forge_sessions, public.forge_login_attempts,
  public.gym_routines, public.gym_exercises, public.gym_exercise_sets to service_role;

create or replace function public.verify_forge_account(candidate_secret text)
returns table(account_id uuid, account_name text)
language sql security invoker set search_path = ''
as $$
  select id, name from public.forge_accounts
  where active and singleton and name = 'Rafi'
    and octet_length(candidate_secret) between 1 and 72
    and secret_hash = extensions.crypt(candidate_secret, secret_hash)
$$;
revoke all on function public.verify_forge_account(text) from public, anon, authenticated;
grant execute on function public.verify_forge_account(text) to service_role;

-- Atomic reservation avoids a parallel-request race in the limiter.
create or replace function public.reserve_forge_login_attempt(p_fingerprint text, p_max integer)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if p_max not between 1 and 40 then raise exception 'Invalid limit'; end if;
  insert into public.forge_login_attempts as attempt (fingerprint, attempts, window_started_at)
  values (p_fingerprint, 1, now())
  on conflict (fingerprint) do update set
    attempts = case when attempt.window_started_at <= now() - interval '15 minutes' then 1 else attempt.attempts + 1 end,
    window_started_at = case when attempt.window_started_at <= now() - interval '15 minutes' then now() else attempt.window_started_at end
  where attempt.window_started_at <= now() - interval '15 minutes' or attempt.attempts < p_max;
  return found;
end;
$$;
revoke all on function public.reserve_forge_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.reserve_forge_login_attempt(text, integer) to service_role;

-- Insert a routine or replace its exercise plan atomically.
-- Editing exercises never overwrites the routine's name/day/note.
create or replace function public.write_forge_routine(
  p_user_id uuid, p_routine_id uuid, p_create boolean,
  p_name text, p_training_day text, p_note text, p_exercises jsonb
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_exercise jsonb;
  v_exercise_id uuid;
  v_set jsonb;
begin
  if not exists (select 1 from public.forge_accounts where id = p_user_id and active and name = 'Rafi') then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' or jsonb_array_length(p_exercises) > 100 then
    raise exception 'Invalid exercises';
  end if;
  if p_create then
    insert into public.gym_routines(id, user_id, name, training_day, note)
    values(p_routine_id, p_user_id, p_name, p_training_day, p_note);
  else
    perform 1 from public.gym_routines where id = p_routine_id and user_id = p_user_id for update;
    if not found then raise exception 'Routine not found' using errcode = 'P0002'; end if;
    update public.gym_routines set updated_at = now() where id = p_routine_id and user_id = p_user_id;
    delete from public.gym_exercises where routine_id = p_routine_id and user_id = p_user_id;
  end if;

  for v_exercise in select value from jsonb_array_elements(p_exercises) loop
    if jsonb_typeof(v_exercise->'sets') is distinct from 'array' then raise exception 'Invalid sets'; end if;
    if jsonb_array_length(v_exercise->'sets') not between 1 and 100 then raise exception 'Invalid set count'; end if;
    insert into public.gym_exercises(routine_id, user_id, name, image_path, sort_order)
    values(p_routine_id, p_user_id, v_exercise->>'name', v_exercise->>'image_path', (v_exercise->>'sort_order')::integer)
    returning id into v_exercise_id;
    for v_set in select value from jsonb_array_elements(v_exercise->'sets') loop
      insert into public.gym_exercise_sets(exercise_id, user_id, set_number, weight_kg, reps)
      values(v_exercise_id, p_user_id, (v_set->>'set_number')::integer, (v_set->>'weight_kg')::numeric, (v_set->>'reps')::integer);
    end loop;
  end loop;
  return p_routine_id;
end;
$$;
revoke all on function public.write_forge_routine(uuid, uuid, boolean, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_forge_routine(uuid, uuid, boolean, text, text, text, jsonb) to service_role;

-- Private bucket: only the authenticated Forge server signs temporary links.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('forge-exercise-images', 'forge-exercise-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
commit;
