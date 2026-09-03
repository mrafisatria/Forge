import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createECDH } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHandler, sha256 } from '../supabase/functions/forge-api/handler.ts';
import { dispatchPush, validateSubscription } from '../supabase/functions/forge-api/push.ts';
import { createPushTransport } from '../supabase/functions/forge-api/push-transport.ts';

const account = '10000000-0000-4000-8000-000000000001';
const subId = '20000000-0000-4000-8000-000000000002';
const timerId = '30000000-0000-4000-8000-000000000003';
const token = 'forge_' + 'a'.repeat(43), hash = await sha256(token);
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const subscription = { endpoint: 'https://web.push.apple.com/test-only-not-a-real-subscription', keys: {
  p256dh: ecdh.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url'),
} };
function fixture() {
  const state = { calls: [], generated: 0, delivered: [], status: 201, rpcError: null, tables: {
    forge_push_settings: [{ id: true, dispatch_secret: 'b'.repeat(64), enabled: true, public_key: null, private_key: null }],
    forge_push_subscriptions: [{ id: subId, account_id: account, session_hash: hash, endpoint: subscription.endpoint, ...subscription.keys }],
    forge_timer_notifications: [], forge_accounts: [{ id: account, name: 'Rafi', active: true }],
    forge_sessions: [{ account_id: account, token_hash: hash, expires_at: new Date(Date.now() + 100000).toISOString() }],
  } };
  const admin = {
    from(table) {
      assert.ok(table.startsWith('forge_'));
      const filters = []; let operation = 'select', payload;
      const query = {
        select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        update(data) { operation = 'update'; payload = data; return query; }, delete() { operation = 'delete'; return query; },
        async single() { return query.maybeSingle(); },
        async maybeSingle() { const result = run(); return { ...result, data: result.data[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      function run() {
        const match = (row) => filters.every(([key, value]) => row[key] === value);
        const rows = state.tables[table].filter(match);
        if (operation === 'update') rows.forEach((row) => Object.assign(row, payload));
        if (operation === 'delete') state.tables[table] = state.tables[table].filter((row) => !match(row));
        return { data: rows, error: null };
      }
      return query;
    },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (name === 'register_forge_push') return { data: subId, error: null };
      if (name === 'write_forge_timer') return { data: { state: args.p_action === 'cancel' ? 'cancelled' : 'pending' }, error: null };
      if (name === 'claim_forge_timer_notifications') return { data: structuredClone(state.tables.forge_timer_notifications), error: null };
      throw new Error('Unexpected RPC');
    },
  };
  const transport = {
    generateKeys() { state.generated++; return { publicKey: 'public-test-key', privateKey: 'private-test-key' }; },
    async send(sub, payload, keys) { state.delivered.push({ sub, payload: JSON.parse(payload), keys }); return state.status; },
  };
  const handler = createHandler(() => ({ admin, fingerprintKey: 'test-only' }), transport);
  async function request(path, { method = 'GET', body, bearer = token } = {}) {
    return handler(new Request('https://test.invalid/functions/v1/forge-api' + path, {
      method, headers: bearer ? { Authorization: 'Bearer ' + bearer } : {}, body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }
  function due() {
    Object.assign(state.tables.forge_push_settings[0], { private_key: 'private-test-key', public_key: 'public-test-key' });
    state.tables.forge_timer_notifications.push({ id: timerId, subscription_id: subId, account_id: account, session_hash: hash,
      state: 'sending', claim_id: 'claim-test', attempts: 1, deadline: new Date(Date.now() - 10000).toISOString() });
  }
  const dispatchRequest = () => new Request('https://test.invalid/push/dispatch', { method: 'POST', headers: { 'x-forge-dispatch': 'b'.repeat(64) } });
  return { state, admin, transport, request, due, dispatchRequest };
}
test('push accepts browser endpoints and valid encryption keys', async () => {
  assert.deepEqual(await validateSubscription(subscription), subscription);
  for (const host of ['fcm.googleapis.com', 'updates.push.services.mozilla.com']) {
    assert.equal((await validateSubscription({ ...subscription, endpoint: `https://${host}/test` })).endpoint, `https://${host}/test`);
  }
});
test('push rejects SSRF, credentials, ports and malformed encryption keys', async () => {
  for (const endpoint of ['http://web.push.apple.com/test', 'https://localhost/test', 'https://127.0.0.1/test',
    'https://web.push.apple.com.attacker.test/x', 'https://user:secret@web.push.apple.com/x',
    'https://web.push.apple.com:8443/x', 'https://web.push.apple.com/x#fragment', 'file:///tmp/x']) {
    await assert.rejects(validateSubscription({ ...subscription, endpoint }), { status: 400 });
  }
  for (const keys of [{ ...subscription.keys, auth: 'bad' }, { ...subscription.keys, p256dh: Buffer.alloc(65).toString('base64url') }]) {
    await assert.rejects(validateSubscription({ ...subscription, keys }), { status: 400 });
  }
});
test('configuration requires Forge auth and never leaks private keys', async () => {
  const { request, state } = fixture();
  assert.equal((await request('/push/config', { bearer: null })).status, 401);
  assert.equal((await request('/push/config', { bearer: 'dompetku_wrong' })).status, 401);
  const response = await request('/push/config');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { public_key: 'public-test-key' });
  await request('/push/config'); assert.equal(state.generated, 1);
});
test('subscription and timer writes use authenticated owner/session, with bounded durations', async () => {
  const { request, state } = fixture();
  assert.equal((await request('/push/subscriptions', { method: 'POST', body: { subscription, account_id: 'attacker' } })).status, 200);
  assert.equal(state.calls.at(-1).args.p_account, account);
  assert.equal(state.calls.at(-1).args.p_session, hash);
  const timer = { id: timerId, subscription_id: subId, duration: 60, deadline: Date.now() + 60000, foreground: true, action: 'start' };
  assert.equal((await request('/push/timer', { method: 'POST', body: timer })).status, 200);
  assert.equal(state.calls.at(-1).args.p_session, hash);
  for (const change of [{ duration: 1000 }, { deadline: Date.now() + 3600000 }, { foreground: 'true' }]) {
    assert.equal((await request('/push/timer', { method: 'POST', body: { ...timer, ...change } })).status, 400);
  }
  assert.equal((await request('/push/timer', { method: 'POST', body: timer, bearer: null })).status, 401);
  state.rpcError = { code: 'P0002' };
  assert.equal((await request('/push/timer', { method: 'POST', body: timer })).status, 404);
});
test('disabling notifications only removes the callers device', async () => {
  const { request, state } = fixture();
  await request('/push/subscriptions', { method: 'DELETE', body: { id: timerId } });
  assert.equal(state.tables.forge_push_subscriptions.length, 1);
  await request('/push/subscriptions', { method: 'DELETE', body: { id: subId } });
  assert.equal(state.tables.forge_push_subscriptions.length, 0);
});
test('browser session cannot invoke internal dispatch', async () => {
  const { request, state, admin, transport } = fixture();
  assert.equal((await request('/push/dispatch', { method: 'POST', body: {} })).status, 401);
  await assert.rejects(dispatchPush(new Request('https://test.invalid', { method: 'POST', headers: { 'x-forge-dispatch': 'c'.repeat(64) } }), admin, transport), { status: 401 });
  assert.equal(state.calls.length, 0);
});
test('dispatcher targets the claimed device and marks successful delivery', async () => {
  const { state, admin, transport, due, dispatchRequest } = fixture(); due();
  assert.deepEqual(await dispatchPush(dispatchRequest(), admin, transport), { delivered: 1 });
  assert.equal(state.delivered[0].payload.type, 'forge-rest-timer');
  assert.equal(state.delivered[0].payload.id, timerId);
  assert.equal(state.tables.forge_timer_notifications[0].state, 'sent');
  assert.ok(!JSON.stringify(state.delivered[0].payload).includes(hash));
});
test('dispatcher cannot send after logout or device session replacement', async () => {
  const { state, admin, transport, due, dispatchRequest } = fixture(); due();
  state.tables.forge_push_subscriptions[0].session_hash = 'different-session';
  assert.deepEqual(await dispatchPush(dispatchRequest(), admin, transport), { delivered: 0 });
  assert.equal(state.tables.forge_timer_notifications[0].state, 'cancelled');
});
test('expired subscriptions are removed; retry is bounded and avoids permanent errors', async () => {
  for (const status of [410, 404, 429, 500, 400]) {
    const { state, admin, transport, due, dispatchRequest } = fixture(); due(); state.status = status;
    await dispatchPush(dispatchRequest(), admin, transport);
    if ([404, 410].includes(status)) assert.equal(state.tables.forge_push_subscriptions.length, 0);
    else assert.equal(state.tables.forge_timer_notifications[0].state, status === 400 ? 'failed' : 'pending');
  }
  const { state, admin, transport, due, dispatchRequest } = fixture(); due(); state.status = 500;
  state.tables.forge_timer_notifications[0].attempts = 3;
  await dispatchPush(dispatchRequest(), admin, transport);
  assert.equal(state.tables.forge_timer_notifications[0].state, 'failed');
});
test('transport encrypts payload, signs VAPID and refuses redirects', async () => {
  let sent;
  const transport = createPushTransport(async (url, options) => { sent = { url, options }; return new Response(null, { status: 201 }); });
  const message = JSON.stringify({ type: 'forge-rest-timer', id: timerId });
  assert.equal(await transport.send(subscription, message, transport.generateKeys()), 201);
  assert.equal(sent.url, subscription.endpoint);
  assert.equal(sent.options.redirect, 'error');
  assert.equal(Number(sent.options.headers.TTL), 60);
  assert.match(sent.options.headers.Authorization, /^vapid /);
  assert.equal(sent.options.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(!Buffer.from(sent.options.body).toString().includes(message));
});
async function workerFixture() {
  const events = {}, notifications = [], opened = [];
  const self = { location: { origin: 'https://forgezone.vercel.app' },
    addEventListener(name, handler) { events[name] = handler; },
    registration: { async showNotification(title, options) { notifications.push({ title, options }); } },
    clients: { async matchAll() { return [{ url: 'https://forgezone.vercel.app/', postMessage() {}, async focus() { opened.push('focus'); } }]; }, async openWindow(url) { opened.push(url); } },
    async skipWaiting() {},
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL });
  async function fire(name, data) { let done; events[name]({ ...data, waitUntil(promise) { done = promise; } }); await done; }
  return { self, fire, notifications, opened };
}
test('worker shows a silent, deduplicated notification, never alarm audio', async () => {
  const { fire, notifications } = await workerFixture();
  await fire('push', { data: { json: () => ({ type: 'forge-rest-timer', id: timerId }) } });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.silent, true);
  assert.equal(notifications[0].options.renotify, false);
  assert.equal(notifications[0].options.tag, 'forge-timer-' + timerId);
});
test('notification click focuses or opens Forge, not a payload URL', async () => {
  const { self, fire, opened } = await workerFixture();
  const notification = { close() {}, data: { url: 'https://attacker.invalid' } };
  await fire('notificationclick', { notification });
  assert.deepEqual(opened, ['focus']);
  self.clients.matchAll = async () => [];
  await fire('notificationclick', { notification });
  assert.deepEqual(opened, ['focus', '/']);
});
test('worker rejects malformed or unrecognized pushes', async () => {
  const { fire, notifications } = await workerFixture();
  await fire('push', { data: { json: () => ({ type: 'other', id: timerId }) } });
  await fire('push', { data: { json: () => { throw new Error('Bad JSON'); } } });
  assert.equal(notifications.length, 0);
});
