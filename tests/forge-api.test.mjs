import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler, sha256 } from '../supabase/functions/forge-api/handler.ts';
import { exercises, metadata, imagePath, imageExtension, secret } from '../supabase/functions/forge-api/validation.ts';
import { validateMedia, mp4Duration } from '../supabase/functions/forge-api/media-validation.ts';
import { validateUploadSize, isVideoPath } from '../lib/media.ts';

const owner = '10000000-0000-4000-8000-000000000001';
const routineId = '20000000-0000-4000-8000-000000000002';
const otherId = '30000000-0000-4000-8000-000000000003';
const imageId = '40000000-0000-4000-8000-000000000004';
const testSecret = 'test-fixture-only';

function fixture() {
  const state = {
    tables: {
      forge_accounts: [{ id: owner, name: 'Rafi', active: true }],
      forge_sessions: [],
      gym_routines: [],
      forge_media: [],
    },
    attempts: new Map(), calls: [], writes: [], error: null, objects: new Map(),
  };
  const admin = {
    from(table) {
      assert.ok(Object.hasOwn(state.tables, table), 'Only isolated Forge tables may be accessed: ' + table);
      state.calls.push(table);
      let operation = 'select', payload, filters = [], range;
      const run = () => {
        if (state.error) return { data: null, error: state.error };
        const matches = (row) => filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : op === 'in' ? value.includes(row[key]) : op === 'ilike' ? row[key].toLowerCase().includes(value.slice(1, -1).toLowerCase()) : row[key] < value);
        if (operation === 'insert') { state.tables[table].push(payload); return { data: payload, error: null }; }
        const found = state.tables[table].filter(matches);
        if (operation === 'delete') state.tables[table] = state.tables[table].filter((row) => !matches(row));
        if (operation === 'update') found.forEach((row) => Object.assign(row, payload));
        return { data: range ? found.slice(range[0], range[1] + 1) : found, error: null };
      };
      const query = {
        select() { return query; },
        order() { return query; },
        eq(key, value) { filters.push(['eq', key, value]); return query; },
        lt(key, value) { filters.push(['lt', key, value]); return query; },
        in(key, value) { filters.push(['in', key, value]); return query; },
        ilike(key, value) { filters.push(['ilike', key, value]); return query; },
        range(start, end) { range = [start, end]; return query; },
        insert(value) { operation = 'insert'; payload = value; return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        delete() { operation = 'delete'; return query; },
        async maybeSingle() { const result = run(); return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data }; },
        async single() { return query.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'forge-exercise-images');
      return {
        async upload(path, file) { state.objects.set(path, file); return { error: null }; },
        async remove(paths) { paths.forEach((path) => state.objects.delete(path)); return { error: null }; },
        async createSignedUrls(paths) { return { data: paths.map((path) => ({ path, signedUrl: 'https://signed.test/' + path })), error: null }; },
        async createSignedUrl(path) { return { data: { signedUrl: 'https://signed.test/' + path }, error: null }; },
      };
    } },
    rpc(name, args) {
      state.calls.push(name);
      if (name === 'verify_forge_account') return { async maybeSingle() {
        const account = state.tables.forge_accounts[0];
        return { data: args.candidate_secret === testSecret && account.active ? { account_id: owner, account_name: account.name } : null, error: null };
      } };
      if (name === 'reserve_forge_login_attempt') {
        const n = state.attempts.get(args.p_fingerprint) ?? 0;
        state.attempts.set(args.p_fingerprint, n + 1);
        return Promise.resolve({ data: n < args.p_max, error: null });
      }
      if (name === 'write_forge_routine') {
        state.writes.push(args);
        return Promise.resolve({ data: routineId, error: null });
      }
      throw new Error('Unexpected RPC: ' + name);
    },
  };
  const handler = createHandler(() => ({ admin, fingerprintKey: 'test-server-key' }));
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return handler(new Request('https://example.test/functions/v1/forge-api' + path, {
      method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    }));
  }
  async function login() {
    const response = await request('/login', { method: 'POST', body: { secret_key: testSecret } });
    assert.equal(response.status, 200);
    return response.json();
  }
  return { state, request, login, handler };
}

test('only Rafi can log in; only a token hash is stored', async () => {
  const { login, state } = fixture();
  const session = await login();
  assert.equal(session.user.name, 'Rafi');
  assert.match(session.session_token, /^forge_[A-Za-z0-9_-]{43}$/);
  assert.equal(state.tables.forge_sessions[0].token_hash, await sha256(session.session_token));
  assert.ok(!JSON.stringify(state.tables).includes(testSecret));
  assert.ok(!JSON.stringify(state.tables).includes(session.session_token));
});

test('incorrect key is rejected and registration does not exist', async () => {
  const { request, state } = fixture();
  assert.equal((await request('/login', { method: 'POST', body: { secret_key: 'wrong' } })).status, 401);
  assert.equal((await request('/register', { method: 'POST', body: { name: 'Other' } })).status, 404);
  assert.equal(state.tables.forge_sessions.length, 0);
});

test('a credential matching any other name still cannot log in', async () => {
  const { request, state } = fixture();
  state.tables.forge_accounts[0].name = 'Other';
  assert.equal((await request('/login', { method: 'POST', body: { secret_key: testSecret } })).status, 401);
});

test('ninth failed login attempt is throttled', async () => {
  const { request } = fixture();
  for (let i = 0; i < 8; i++) assert.equal((await request('/login', { method: 'POST', body: { secret_key: 'wrong' } })).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: { secret_key: testSecret } })).status, 429);
});

test('unauthenticated read/write/upload and Dompetku tokens are rejected', async () => {
  const { request } = fixture();
  for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) assert.equal((await request('/routines', { method })).status, 401);
  assert.equal((await request('/images', { method: 'POST' })).status, 401);
  assert.equal((await request('/routines', { token: 'a'.repeat(43) })).status, 401);
  assert.equal((await request('/routines', { token: 'forge_' + 'a'.repeat(43) })).status, 401);
});

test('expired session and disabled account cannot access routines', async () => {
  const { request, login, state } = fixture();
  const session = await login();
  state.tables.forge_sessions[0].expires_at = '2000-01-01T00:00:00Z';
  assert.equal((await request('/routines', { token: session.session_token })).status, 401);
  const second = await login();
  state.tables.forge_accounts[0].active = false;
  assert.equal((await request('/routines', { token: second.session_token })).status, 401);
});

test('listing routines filters ownership and logout revokes the session', async () => {
  const { request, login, state } = fixture();
  const session = await login();
  state.tables.gym_routines.push({ id: routineId, user_id: owner, gym_exercises: [] }, { id: otherId, user_id: otherId, gym_exercises: [] });
  const response = await request('/routines', { token: session.session_token });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).routines.map((r) => r.id), [routineId]);
  assert.equal((await request('/logout', { method: 'POST', token: session.session_token })).status, 200);
  assert.equal((await request('/routines', { token: session.session_token })).status, 401);
});

test('client cannot forge ownership on create; routine may start empty', async () => {
  const { request, login, state } = fixture();
  const session = await login();
  const response = await request('/routines', { method: 'POST', token: session.session_token, body: { id: routineId, name: 'Senin', user_id: otherId, exercises: [] } });
  assert.equal(response.status, 201);
  assert.equal(state.writes[0].p_user_id, owner);
  assert.deepEqual(state.writes[0].p_exercises, []);
});

test('metadata editing leaves exercises unchanged; another owner cannot be deleted', async () => {
  const { request, login, state } = fixture();
  const session = await login();
  state.tables.gym_routines.push({ id: routineId, user_id: owner, name: 'Old', gym_exercises: [{ name: 'Bench' }] }, { id: otherId, user_id: otherId });
  assert.equal((await request('/routines', { method: 'PATCH', token: session.session_token, body: { id: routineId, name: 'New' } })).status, 200);
  assert.equal(state.tables.gym_routines[0].gym_exercises[0].name, 'Bench');
  assert.equal((await request('/routines', { method: 'DELETE', token: session.session_token, body: { id: otherId } })).status, 404);
  assert.equal(state.tables.gym_routines.length, 2);
});

test('exercise replacement does not accept routine metadata', async () => {
  const { request, login, state } = fixture();
  const session = await login();
  assert.equal((await request('/routines', { method: 'PUT', token: session.session_token, body: { id: routineId, name: 'Unwanted rename', exercises: [] } })).status, 200);
  assert.equal(state.writes[0].p_create, false);
  assert.equal(state.writes[0].p_name, null);
});

test('validation allows decimal kg and rejects invalid reps, images, and oversized lists', () => {
  const input = [{ name: 'Bench', sets: [{ weight_kg: 2.5, reps: 10 }] }];
  assert.equal(exercises(input, owner, routineId)[0].sets[0].weight_kg, 2.5);
  for (const kg of [-1, Infinity, NaN, 2.555, '2,5']) assert.throws(() => exercises([{ ...input[0], sets: [{ weight_kg: kg, reps: 10 }] }], owner, routineId));
  assert.throws(() => exercises([{ ...input[0], sets: [{ weight_kg: 5, reps: 2.5 }] }], owner, routineId));
  assert.throws(() => exercises([{ name: 'Bench', sets: [] }], owner, routineId));
  assert.throws(() => exercises(Array(101).fill(input[0]), owner, routineId));
  assert.throws(() => metadata({ name: ' ' }));
  assert.throws(() => secret('a'.repeat(73)));
  assert.throws(() => imagePath(`${otherId}/${routineId}/${imageId}.png`, owner, routineId));
  assert.throws(() => imagePath('https://arbitrary.example/image.png', owner, routineId));
  assert.throws(() => imagePath(`${owner}/${routineId}/../../../secret`, owner, routineId));
  assert.equal(imagePath(`${owner}/${routineId}/${imageId}.png`, owner, routineId), `${owner}/${routineId}/${imageId}.png`);
});

test('photo validation checks bytes, MIME type, and size', async () => {
  assert.equal(await imageExtension(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'test.png', { type: 'image/png' })), 'png');
  await assert.rejects(imageExtension(new File(['<svg>not a png</svg>'], 'test.png', { type: 'image/png' })));
  await assert.rejects(imageExtension(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'test.png', { type: 'image/png' })));
});

test('oversized requests are rejected; internal errors do not expose server details', async () => {
  const { request, handler, state, login } = fixture();
  assert.equal((await handler(new Request('https://example.test/forge-api/login', { method: 'POST', headers: { 'content-length': '2000000' }, body: '{}' }))).status, 413);
  const session = await login();
  state.error = { message: 'private database configuration' };
  const response = await request('/routines', { token: session.session_token });
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('private database'));
});

function mp4Fixture(seconds = 2, version = 0) {
  const box = (type, ...contents) => {
    const payload = Buffer.concat(contents); const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.length + 8); header.write(type, 4); return Buffer.concat([header, payload]);
  };
  const time = Buffer.alloc(version === 1 ? 32 : 20); time[0] = version;
  time.writeUInt32BE(1000, version === 1 ? 20 : 12);
  if (version === 1) time.writeBigUInt64BE(BigInt(seconds * 1000), 24); else time.writeUInt32BE(seconds * 1000, 16);
  const hdlr = Buffer.alloc(12); hdlr.write('vide', 8);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0mp42')),
    box('moov', box('mvhd', time), box('trak', box('mdia', box('mdhd', time), box('hdlr', hdlr)))),
    box('mdat', Buffer.from([0, 1, 2, 3])),
  ]);
}

test('media validation accepts 2-second MP4 and rejects long, truncated, or forged files', async () => {
  assert.equal(mp4Duration(mp4Fixture(2)), 2);
  assert.equal(mp4Duration(mp4Fixture(2, 1)), 2);
  const result = await validateMedia(new File([mp4Fixture()], 'demo.mp4', { type: 'video/mp4' }));
  assert.equal(result.kind, 'video'); assert.equal(result.duration, 2);
  for (const bytes of [mp4Fixture(4), mp4Fixture().subarray(0, 25), Buffer.from('not an mp4'), mp4Fixture(0)]) assert.throws(() => mp4Duration(bytes));
  await assert.rejects(validateMedia(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.mp4', { type: 'video/mp4' })));
  await assert.rejects(validateMedia(new File([mp4Fixture()], 'demo.webm', { type: 'video/webm' })));
  assert.throws(() => validateUploadSize({ type: 'image/png', size: 6 * 1024 * 1024 }));
  assert.throws(() => validateUploadSize({ type: 'image/svg+xml', size: 100 }));
  assert.equal(isVideoPath('account/library/file.mp4'), true);
  assert.equal(isVideoPath('account/library/file.png'), false);
});

test('media routes reject anonymous users and unsupported operations', async () => {
  const { request, login } = fixture();
  assert.equal((await request('/media')).status, 401);
  assert.equal((await request('/media', { method: 'POST' })).status, 401);
  const session = await login();
  assert.equal((await request('/media', { method: 'DELETE', token: session.session_token })).status, 405);
});

test('media uploads persist metadata, deduplicate retries, and return private signed links', async () => {
  const { request, login, state } = fixture(); const { session_token: token } = await login();
  const body = new FormData(); body.append('file', new File([mp4Fixture()], 'bench.mp4', { type: 'video/mp4' }));
  const uploaded = await request('/media', { method: 'POST', token, body });
  assert.equal(uploaded.status, 201);
  const first = await uploaded.json();
  assert.equal(first.media.kind, 'video'); assert.equal(first.media.duration_seconds, 2);
  assert.ok(first.media.image_path.startsWith(owner + '/library/'));
  assert.match(first.media.image_url, /^https:\/\/signed.test\//);
  const retry = await request('/media', { method: 'POST', token, body });
  assert.equal(retry.status, 200); assert.equal((await retry.json()).reused, true);
  assert.equal(state.objects.size, 1); assert.equal(state.tables.forge_media.length, 1);
  state.tables.forge_media.push({ id: otherId, user_id: otherId, name: 'Private other', image_path: `${otherId}/library/${imageId}.png` });
  const list = await request('/media', { token }); assert.equal(list.status, 200);
  assert.equal((await list.json()).media.length, 1);
  const search = await request('/media?q=missing', { token }); assert.equal((await search.json()).media.length, 0);
  assert.equal((await request('/media?offset=-1', { token })).status, 400);
});

test('gallery selection can be reused across routines but rejects missing or foreign media', async () => {
  const { request, login, state } = fixture(); const { session_token: token } = await login();
  const path = `${owner}/library/${imageId}.png`;
  const makeBody = (image_path) => ({ id: routineId, name: 'My routine', exercises: [{ name: 'Bench', image_path, sets: [{ weight_kg: 2.5, reps: 10 }] }] });
  assert.equal((await request('/routines', { method: 'POST', token, body: makeBody(path) })).status, 400);
  state.tables.forge_media.push({ id: imageId, user_id: owner, image_path: path });
  assert.equal((await request('/routines', { method: 'POST', token, body: makeBody(path) })).status, 201);
  assert.equal((await request('/routines', { method: 'PUT', token, body: { ...makeBody(path), id: otherId } })).status, 200);
  assert.equal((await request('/routines', { method: 'POST', token, body: makeBody(`${otherId}/library/${imageId}.png`) })).status, 400);
  assert.equal(state.writes[0].p_exercises[0].image_path, path);
  assert.equal(state.objects.size, 0, 'Selecting media never uploads copies');
});

test('mixed upload results preserve successful files; long video is rejected before storage', async () => {
  const { request, login, state } = fixture(); const { session_token: token } = await login();
  const statuses = [];
  for (const [name, bytes] of [['first.mp4', mp4Fixture(2)], ['long.mp4', mp4Fixture(4)], ['second.mp4', mp4Fixture(1)]]) {
    const body = new FormData(); body.append('file', new File([bytes], name, { type: 'video/mp4' }));
    statuses.push((await request('/media', { method: 'POST', token, body })).status);
  }
  assert.deepEqual(statuses, [201, 400, 201]);
  assert.equal(state.objects.size, 2); assert.equal(state.tables.forge_media.length, 2);
});

test('image library uploads and legacy photo uploads are both registered', async () => {
  const { request, login, state } = fixture(); const { session_token: token } = await login();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGfQAAAAASUVORK5CYII=', 'base64');
  const galleryForm = new FormData(); galleryForm.append('file', new File([png], 'image.png', { type: 'image/png' }));
  const gallery = await request('/media', { method: 'POST', token, body: galleryForm });
  assert.equal(gallery.status, 201); assert.equal((await gallery.json()).media.kind, 'image');
  const legacyForm = new FormData(); legacyForm.append('file', new File([png], 'old-client.png', { type: 'image/png' })); legacyForm.append('routine_id', routineId);
  assert.equal((await request('/images', { method: 'POST', token, body: legacyForm })).status, 201);
  assert.equal(state.tables.forge_media.length, 2);
});

test('gallery pagination returns the next page without leaking another account', async () => {
  const { request, login, state } = fixture(); const { session_token: token } = await login();
  state.tables.forge_media.push(...Array.from({ length: 65 }, (_, index) => ({ id: String(index), name: 'Photo ' + index, user_id: owner, image_path: `${owner}/library/${index}.png` })));
  const first = await (await request('/media', { token })).json();
  assert.equal(first.media.length, 60); assert.equal(first.next_offset, 60);
  const last = await (await request('/media?offset=60', { token })).json();
  assert.equal(last.media.length, 5); assert.equal(last.next_offset, null);
});
