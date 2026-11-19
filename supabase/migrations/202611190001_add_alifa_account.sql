begin;

alter table public.forge_accounts
  drop constraint if exists forge_accounts_singleton_key,
  drop constraint if exists forge_accounts_singleton_check,
  drop constraint if exists forge_accounts_name_check,
  drop column if exists singleton;

alter table public.forge_accounts
  add constraint forge_accounts_name_check check (name in ('Rafi', 'Alifa')),
  add constraint forge_accounts_name_key unique (name);

create or replace function public.verify_forge_account(candidate_secret text)
returns table(account_id uuid, account_name text)
language sql security invoker set search_path = ''
as $$
  select id, name from public.forge_accounts
  where active
    and octet_length(candidate_secret) between 1 and 72
    and secret_hash = extensions.crypt(candidate_secret, secret_hash)
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
  if not exists (select 1 from public.forge_accounts where id = p_user_id and active) then
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
    insert into public.gym_exercises(routine_id, user_id, name, target_reps, is_hidden, image_path, sort_order)
    values(
      p_routine_id, p_user_id, v_exercise->>'name', v_exercise->>'target_reps',
      coalesce((v_exercise->>'is_hidden')::boolean, false), v_exercise->>'image_path', (v_exercise->>'sort_order')::integer
    )
    returning id into v_exercise_id;
    for v_set in select value from jsonb_array_elements(v_exercise->'sets') loop
      insert into public.gym_exercise_sets(exercise_id, user_id, set_number, weight_kg, reps)
      values(v_exercise_id, p_user_id, (v_set->>'set_number')::integer, (v_set->>'weight_kg')::numeric, (v_set->>'reps')::integer);
    end loop;
  end loop;
  return p_routine_id;
end;
$$;

create or replace function public.claim_forge_timer_notifications()
returns setof public.forge_timer_notifications language plpgsql security definer set search_path = '' as $$
begin
  update public.forge_timer_notifications set state = 'failed', claim_id = null
    where state in ('pending', 'sending')
      and (deadline < now() - interval '2 minutes' or (attempts >= 3 and retry_at <= now()));
  return query
  with due as (
    select t.id from public.forge_timer_notifications t
    join public.forge_push_subscriptions s on s.id = t.subscription_id and s.session_hash = t.session_hash
    join public.forge_sessions fs on fs.token_hash = t.session_hash and fs.expires_at > now()
    join public.forge_accounts a on a.id = t.account_id and a.active
    where ((t.state = 'pending' and (not t.foreground or t.last_seen_at < now() - interval '12 seconds'))
        or (t.state = 'sending' and t.retry_at < now()))
      and t.deadline <= now() - interval '2 seconds' and t.retry_at <= now() and t.attempts < 3
    order by t.deadline limit 10 for update of t skip locked
  )
  update public.forge_timer_notifications t set state = 'sending', attempts = attempts + 1,
    claim_id = gen_random_uuid(), retry_at = now() + interval '30 seconds'
    from due where t.id = due.id returning t.*;
end $$;

revoke all on function public.verify_forge_account(text),
  public.write_forge_routine(uuid, uuid, boolean, text, text, text, jsonb),
  public.claim_forge_timer_notifications() from public, anon, authenticated;
grant execute on function public.verify_forge_account(text),
  public.write_forge_routine(uuid, uuid, boolean, text, text, text, jsonb),
  public.claim_forge_timer_notifications() to service_role;

commit;
