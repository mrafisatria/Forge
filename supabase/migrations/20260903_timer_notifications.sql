-- Forge-only Web Push storage and dispatcher. Never touches Dompetku data.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.forge_push_settings (
  id boolean primary key default true check (id),
  dispatch_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  public_key text,
  private_key text,
  enabled boolean not null default true
);
insert into public.forge_push_settings(id) values (true);

create table public.forge_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.forge_accounts(id) on delete cascade,
  session_hash text not null references public.forge_sessions(token_hash) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2048),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique(id, account_id, session_hash)
);
create table public.forge_timer_notifications (
  id uuid primary key,
  subscription_id uuid not null references public.forge_push_subscriptions(id) on delete cascade,
  account_id uuid not null references public.forge_accounts(id) on delete cascade,
  session_hash text not null references public.forge_sessions(token_hash) on delete cascade,
  deadline timestamptz not null,
  state text not null check (state in ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  foreground boolean not null default true,
  last_seen_at timestamptz not null default now(),
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  claim_id uuid,
  created_at timestamptz not null default now()
);
create index forge_timer_notifications_due_idx on public.forge_timer_notifications(deadline, retry_at)
  where state in ('pending', 'sending');

alter table public.forge_push_settings enable row level security;
alter table public.forge_push_subscriptions enable row level security;
alter table public.forge_timer_notifications enable row level security;
revoke all on public.forge_push_settings, public.forge_push_subscriptions, public.forge_timer_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.forge_push_settings, public.forge_push_subscriptions, public.forge_timer_notifications to service_role;

create function public.register_forge_push(p_account uuid, p_session text, p_endpoint text, p_p256dh text, p_auth text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform 1 from public.forge_accounts where id = p_account for update;
  if not exists (select 1 from public.forge_push_subscriptions where endpoint = p_endpoint)
     and (select count(*) from public.forge_push_subscriptions where account_id = p_account) >= 10 then
    raise exception 'Too many devices' using errcode = 'P0001';
  end if;
  insert into public.forge_push_subscriptions(account_id, session_hash, endpoint, p256dh, auth)
    values (p_account, p_session, p_endpoint, p_p256dh, p_auth)
    on conflict(endpoint) do update set session_hash = excluded.session_hash, p256dh = excluded.p256dh, auth = excluded.auth
      where public.forge_push_subscriptions.account_id = p_account
    returning id into result;
  if result is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  return result;
end $$;

-- Lock the device so replacing a timer and cancelling it cannot resurrect old work.
-- Cancel inserts a tombstone even when it arrives before start (network race).
create function public.write_forge_timer(p_account uuid, p_session text, p_subscription uuid,
  p_id uuid, p_action text, p_deadline timestamptz, p_foreground boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_timer public.forge_timer_notifications;
begin
  perform 1 from public.forge_push_subscriptions
    where id = p_subscription and account_id = p_account and session_hash = p_session for update;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  select * into current_timer from public.forge_timer_notifications where id = p_id for update;
  if found and (current_timer.account_id <> p_account or current_timer.subscription_id <> p_subscription or current_timer.session_hash <> p_session) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if p_action = 'start' then
    if current_timer.id is not null then return jsonb_build_object('state', current_timer.state, 'deadline', current_timer.deadline); end if;
    if p_deadline < now() - interval '10 seconds' or p_deadline > now() + interval '245 seconds' then
      raise exception 'Invalid deadline' using errcode = '22023';
    end if;
    if (select count(*) from public.forge_timer_notifications where account_id = p_account and created_at > now() - interval '1 hour') >= 120 then
      raise exception 'Too many timers' using errcode = 'P0001';
    end if;
    update public.forge_timer_notifications set state = 'cancelled', claim_id = null
      where subscription_id = p_subscription and state in ('pending', 'sending');
    insert into public.forge_timer_notifications(id, subscription_id, account_id, session_hash, deadline, state, foreground)
      values(p_id, p_subscription, p_account, p_session, p_deadline, 'pending', p_foreground);
  elsif p_action = 'cancel' then
    insert into public.forge_timer_notifications(id, subscription_id, account_id, session_hash, deadline, state)
      values(p_id, p_subscription, p_account, p_session, now(), 'cancelled')
      on conflict(id) do update set state = 'cancelled', claim_id = null;
  elsif p_action = 'presence' then
    update public.forge_timer_notifications set foreground = p_foreground, last_seen_at = now()
      where id = p_id and state = 'pending';
  else raise exception 'Invalid action' using errcode = '22023';
  end if;
  return (select jsonb_build_object('state', state, 'deadline', deadline) from public.forge_timer_notifications where id = p_id);
end $$;

-- Atomic claims, short delivery window, bounded retries, and session checks.
create function public.claim_forge_timer_notifications()
returns setof public.forge_timer_notifications language plpgsql security definer set search_path = '' as $$
begin
  update public.forge_timer_notifications set state = 'failed', claim_id = null
    where state in ('pending', 'sending') and (deadline < now() - interval '2 minutes' or attempts >= 3);
  return query
  with due as (
    select t.id from public.forge_timer_notifications t
    join public.forge_push_subscriptions s on s.id = t.subscription_id and s.session_hash = t.session_hash
    join public.forge_sessions fs on fs.token_hash = t.session_hash and fs.expires_at > now()
    join public.forge_accounts a on a.id = t.account_id and a.active and a.name = 'Rafi'
    where ((t.state = 'pending' and (not t.foreground or t.last_seen_at < now() - interval '12 seconds'))
        or (t.state = 'sending' and t.retry_at < now()))
      and t.deadline <= now() - interval '2 seconds' and t.retry_at <= now() and t.attempts < 3
    order by t.deadline limit 10 for update of t skip locked
  )
  update public.forge_timer_notifications t set state = 'sending', attempts = attempts + 1,
    claim_id = gen_random_uuid(), retry_at = now() + interval '30 seconds'
    from due where t.id = due.id returning t.*;
end $$;

-- A lightweight DB check every five seconds; no HTTP call while there is no due timer.
-- Only the dedicated, generated dispatcher secret leaves this DB, not a service-role key.
create function public.dispatch_forge_timer_notifications()
returns void language plpgsql security definer set search_path = '' as $$
declare dispatcher_secret text;
begin
  if not exists (select 1 from public.forge_timer_notifications t
    where t.state in ('pending', 'sending') and t.deadline <= now() - interval '2 seconds'
      and t.deadline > now() - interval '3 minutes' and t.retry_at <= now()
      and (not t.foreground or t.last_seen_at < now() - interval '12 seconds')) then return; end if;
  select dispatch_secret into dispatcher_secret from public.forge_push_settings where id and enabled and private_key is not null;
  if dispatcher_secret is null then return; end if;
  perform net.http_post(
    url := 'https://mriotylczlxaxydhorga.supabase.co/functions/v1/forge-api/push/dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-forge-dispatch', dispatcher_secret),
    body := '{}'::jsonb, timeout_milliseconds := 15000
  );
end $$;

revoke all on function public.register_forge_push(uuid,text,text,text,text),
  public.write_forge_timer(uuid,text,uuid,uuid,text,timestamptz,boolean),
  public.claim_forge_timer_notifications(), public.dispatch_forge_timer_notifications() from public, anon, authenticated;
grant execute on function public.register_forge_push(uuid,text,text,text,text),
  public.write_forge_timer(uuid,text,uuid,uuid,text,timestamptz,boolean),
  public.claim_forge_timer_notifications() to service_role;
select cron.schedule('forge-timer-notifications', '5 seconds', 'select public.dispatch_forge_timer_notifications()');
-- Keep only a week of delivery metadata and remove expired device registrations.
select cron.schedule('forge-timer-notification-cleanup', '19 3 * * *', $job$
  delete from public.forge_timer_notifications where created_at < now() - interval '7 days';
  delete from public.forge_push_subscriptions where session_hash in
    (select token_hash from public.forge_sessions where expires_at < now());
  delete from cron.job_run_details where jobid in
    (select jobid from cron.job where jobname in ('forge-timer-notifications', 'forge-timer-notification-cleanup'))
    and end_time < now() - interval '1 day';
$job$);
commit;
