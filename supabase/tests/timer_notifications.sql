-- Administrative integration test. All fixtures and claims are rolled back.
begin;
do $$
declare
  account uuid;
  session_key text := encode(extensions.gen_random_bytes(32), 'hex');
  device uuid;
  timer uuid := gen_random_uuid();
  cancelled uuid := gen_random_uuid();
  count_claimed integer;
  result jsonb;
begin
  select id into strict account from public.forge_accounts where name = 'Rafi' and active;
  insert into public.forge_sessions(token_hash, account_id, expires_at)
    values(session_key, account, now() + interval '1 hour');
  device := public.register_forge_push(account, session_key,
    'https://forge-test.invalid/' || gen_random_uuid(), 'test-only', 'test-only');

  perform public.write_forge_timer(account, session_key, device, cancelled, 'cancel', null, true);
  result := public.write_forge_timer(account, session_key, device, cancelled, 'start', now() + interval '1 minute', true);
  assert result->>'state' = 'cancelled', 'Late start resurrected a cancelled timer';

  perform public.write_forge_timer(account, session_key, device, timer, 'start', now() - interval '5 seconds', true);
  select count(*) into count_claimed from public.claim_forge_timer_notifications() where id = timer;
  assert count_claimed = 0, 'Foreground timer must not be claimed';
  perform public.write_forge_timer(account, session_key, device, timer, 'presence', null, false);
  select count(*) into count_claimed from public.claim_forge_timer_notifications() where id = timer;
  assert count_claimed = 1, 'Background timer was not claimed';
  select count(*) into count_claimed from public.claim_forge_timer_notifications() where id = timer;
  assert count_claimed = 0, 'Timer claimed twice';

  update public.forge_timer_notifications set attempts = 3 where id = timer;
  perform public.claim_forge_timer_notifications();
  assert (select state = 'sending' from public.forge_timer_notifications where id = timer), 'In-flight third attempt invalidated';
  update public.forge_timer_notifications set retry_at = now() - interval '1 second' where id = timer;
  perform public.claim_forge_timer_notifications();
  assert (select state = 'failed' from public.forge_timer_notifications where id = timer), 'Retry limit not enforced';

  delete from public.forge_sessions where token_hash = session_key;
  assert not exists(select 1 from public.forge_push_subscriptions where id = device), 'Logout did not remove subscription';
  assert not exists(select 1 from public.forge_timer_notifications where subscription_id = device), 'Logout did not remove timers';
end $$;
rollback;
select 'PASS: cancellation, foreground, background, atomic claim, retries, logout; fixtures rolled back' as result;
