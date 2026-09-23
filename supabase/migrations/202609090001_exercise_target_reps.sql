begin;

alter table public.gym_exercises
  add column if not exists target_reps text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gym_exercises_target_reps_length_check'
      and conrelid = 'public.gym_exercises'::regclass
  ) then
    alter table public.gym_exercises
      add constraint gym_exercises_target_reps_length_check
      check (target_reps is null or char_length(trim(target_reps)) between 1 and 20);
  end if;
end
$$;

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
    insert into public.gym_exercises(routine_id, user_id, name, target_reps, image_path, sort_order)
    values(p_routine_id, p_user_id, v_exercise->>'name', v_exercise->>'target_reps', v_exercise->>'image_path', (v_exercise->>'sort_order')::integer)
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

commit;
