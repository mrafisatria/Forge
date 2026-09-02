-- Forge Gym Tracker
-- Jalankan seluruh file ini di Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.gym_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  training_day text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gym_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.gym_routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  image_url text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.gym_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.gym_exercises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  weight_kg numeric(8,2) not null default 0 check (weight_kg >= 0),
  reps integer not null default 0 check (reps >= 0),
  created_at timestamptz not null default now(),
  unique (exercise_id, set_number)
);

create index if not exists gym_routines_user_idx on public.gym_routines(user_id, created_at desc);
create index if not exists gym_exercises_routine_idx on public.gym_exercises(routine_id, sort_order);
create index if not exists gym_exercise_sets_exercise_idx on public.gym_exercise_sets(exercise_id, set_number);

create or replace function public.touch_gym_routine_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gym_routines_touch_updated_at on public.gym_routines;
create trigger gym_routines_touch_updated_at
before update on public.gym_routines
for each row execute function public.touch_gym_routine_updated_at();

alter table public.gym_routines enable row level security;
alter table public.gym_exercises enable row level security;
alter table public.gym_exercise_sets enable row level security;

drop policy if exists "Users manage own gym routines" on public.gym_routines;
create policy "Users manage own gym routines"
on public.gym_routines for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own gym exercises" on public.gym_exercises;
create policy "Users manage own gym exercises"
on public.gym_exercises for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.gym_routines routine
    where routine.id = routine_id and routine.user_id = (select auth.uid())
  )
);

drop policy if exists "Users manage own gym sets" on public.gym_exercise_sets;
create policy "Users manage own gym sets"
on public.gym_exercise_sets for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.gym_exercises exercise
    where exercise.id = exercise_id and exercise.user_id = (select auth.uid())
  )
);

-- Menyimpan routine dan seluruh exercise/set secara atomik.
create or replace function public.save_gym_routine(
  p_routine_id uuid,
  p_name text,
  p_training_day text,
  p_note text,
  p_exercises jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_routine_id uuid := coalesce(p_routine_id, gen_random_uuid());
  v_exercise jsonb;
  v_exercise_id uuid;
  v_set jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.gym_routines
    where id = v_routine_id and user_id <> v_user_id
  ) then
    raise exception 'Routine does not belong to current user';
  end if;

  insert into public.gym_routines (id, user_id, name, training_day, note)
  values (v_routine_id, v_user_id, trim(p_name), nullif(trim(p_training_day), ''), nullif(trim(p_note), ''))
  on conflict (id) do update
  set name = excluded.name,
      training_day = excluded.training_day,
      note = excluded.note
  where public.gym_routines.user_id = v_user_id;

  delete from public.gym_exercises
  where routine_id = v_routine_id and user_id = v_user_id;

  for v_exercise in
    select value from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    insert into public.gym_exercises (routine_id, user_id, name, image_url, sort_order)
    values (
      v_routine_id,
      v_user_id,
      trim(v_exercise->>'name'),
      nullif(v_exercise->>'image_url', ''),
      coalesce((v_exercise->>'sort_order')::integer, 0)
    )
    returning id into v_exercise_id;

    for v_set in
      select value from jsonb_array_elements(coalesce(v_exercise->'sets', '[]'::jsonb))
    loop
      insert into public.gym_exercise_sets (exercise_id, user_id, set_number, weight_kg, reps)
      values (
        v_exercise_id,
        v_user_id,
        greatest(coalesce((v_set->>'set_number')::integer, 1), 1),
        greatest(coalesce((v_set->>'weight_kg')::numeric, 0), 0),
        greatest(coalesce((v_set->>'reps')::integer, 0), 0)
      );
    end loop;
  end loop;

  return v_routine_id;
end;
$$;

revoke all on function public.save_gym_routine(uuid, text, text, text, jsonb) from public;
grant execute on function public.save_gym_routine(uuid, text, text, text, jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'forge-exercise-images',
  'forge-exercise-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own Forge exercise images" on storage.objects;
create policy "Users upload own Forge exercise images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'forge-exercise-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users update own Forge exercise images" on storage.objects;
create policy "Users update own Forge exercise images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'forge-exercise-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'forge-exercise-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users delete own Forge exercise images" on storage.objects;
create policy "Users delete own Forge exercise images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'forge-exercise-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
