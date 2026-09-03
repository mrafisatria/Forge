// Scoped integration test: disposable device/timers; never sends a real push.
// Secret arrives via stdin and is never printed or written to disk.
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Missing Supabase configuration');
let secret = '';
for await (const chunk of process.stdin) secret += chunk;
let token, device;
async function call(path, method = 'GET', body, authenticated = true) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (authenticated && token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url}/functions/v1/forge-api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, data: await response.json() };
}
try {
  assert.equal((await call('/push/config')).status, 401);
  const login = await call('/login', 'POST', { secret_key: secret.trim() });
  secret = '';
  assert.equal(login.status, 200, `Login failed: ${login.status}`);
  token = login.data.session_token;
  assert.equal(login.data.user.name, 'Rafi');
  const config = await call('/push/config');
  assert.equal(config.status, 200, `Config failed: ${config.status}`);
  assert.deepEqual(Object.keys(config.data), ['public_key']);
  assert.equal(Buffer.from(config.data.public_key, 'base64url').length, 65);
  console.log('PASS: authenticated VAPID configuration, no private keys exposed');

  const curve = createECDH('prime256v1'); curve.generateKeys();
  const subscription = {
    endpoint: `https://web.push.apple.com/forge-test-${crypto.randomUUID()}`,
    keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  const registered = await call('/push/subscriptions', 'POST', { subscription });
  assert.equal(registered.status, 200, `Device registration failed: ${registered.status}`);
  device = registered.data.id;
  const id = crypto.randomUUID();
  const timer = { id, subscription_id: device, duration: 240, deadline: Date.now() + 240000, foreground: true };
  assert.equal((await call('/push/timer', 'POST', { ...timer, action: 'start' })).data.timer.state, 'pending');
  assert.equal((await call('/push/timer', 'POST', { ...timer, action: 'cancel' })).data.timer.state, 'cancelled');
  assert.equal((await call('/push/timer', 'POST', { ...timer, action: 'start' })).data.timer.state, 'cancelled');
  assert.equal((await call('/push/timer', 'POST', { ...timer, id: crypto.randomUUID(), action: 'start', duration: 5 })).status, 400);
  assert.equal((await call('/push/timer', 'POST', { ...timer, subscription_id: crypto.randomUUID(), action: 'presence' })).status, 404);
  assert.equal((await call('/push/subscriptions', 'POST', { subscription: { ...subscription, endpoint: 'https://example.com/not-allowed' } })).status, 400);
  assert.equal((await call('/push/dispatch', 'POST', {})).status, 401);
  console.log('PASS: register, schedule, cancel, late start, ownership, validation, dispatcher isolation');

  for (const table of ['forge_push_settings', 'forge_push_subscriptions', 'forge_timer_notifications']) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
    assert.ok([401,403].includes(response.status), `Public access unexpectedly allowed: ${table}`);
  }
  console.log('PASS: all three notification tables reject direct public access');
  assert.equal((await call('/routines')).status, 200);
  assert.equal((await call('/media')).status, 200);
  console.log('PASS: existing routine and media reads still work');
} finally {
  secret = '';
  try {
    if (device && token) assert.equal((await call('/push/subscriptions', 'DELETE', { id: device })).status, 200);
  } finally {
    if (token) assert.equal((await call('/logout', 'POST')).status, 200);
  }
  console.log('PASS: disposable subscription, timers, and test session cleaned up');
}
