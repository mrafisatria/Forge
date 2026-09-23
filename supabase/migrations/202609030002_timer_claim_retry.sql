-- Do not invalidate the third delivery attempt while it is still in flight.
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
