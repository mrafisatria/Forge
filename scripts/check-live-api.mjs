// Scoped live smoke test. Secret arrives via stdin; no credentials are logged.
import assert from 'node:assert/strict';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Missing Supabase configuration');
let secret = '';
for await (const chunk of process.stdin) secret += chunk;
const base = `${url}/functions/v1/forge-api`;
let token;
let created = false;
const id = crypto.randomUUID();
async function call(path, method = 'GET', body, authorized = true) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (authorized && token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: response.status, data: await response.json() };
}
try {
  assert.equal((await call('/routines')).status, 401, 'Unauthenticated requests must be denied');
  const loggedIn = await call('/login', 'POST', { secret_key: secret.trim() });
  secret = '';
  assert.equal(loggedIn.status, 200, `Login failed: ${loggedIn.data.error ?? loggedIn.status}`);
  assert.equal(loggedIn.data.user.name, 'Rafi');
  token = loggedIn.data.session_token;
  console.log('PASS: login Rafi');
  const before = await call('/routines');
  assert.equal(before.status, 200);
  assert.equal((await call('/routines', 'POST', { id, name: '__Forge connection check__', exercises: [] })).status, 201);
  created = true;
  let list = await call('/routines');
  assert.deepEqual(list.data.routines.find((r) => r.id === id).gym_exercises, []);
  console.log('PASS: empty routine stored and reloaded');
  assert.equal((await call('/routines', 'PATCH', { id, name: '__Forge verified__', training_day: 'Senin', note: 'Temporary smoke test' })).status, 200);
  assert.equal((await call('/routines', 'PUT', { id, exercises: [
    { name: 'First exercise', target_reps: '6-8', sets: [{ weight_kg: 2.5, reps: 10 }, { weight_kg: 5.25, reps: 8 }] },
    { name: 'Second exercise', target_reps: '10', sets: [{ weight_kg: 10, reps: 10 }] },
  ] })).status, 200);
  list = await call('/routines');
  const routine = list.data.routines.find((r) => r.id === id);
  assert.equal(routine.name, '__Forge verified__');
  const first = routine.gym_exercises.find((exercise) => exercise.name === 'First exercise');
  assert.equal(first.target_reps, '6-8');
  assert.equal(first.sort_order, 0);
  assert.equal(first.gym_exercise_sets.find((s) => s.set_number === 1).weight_kg, 2.5);
  assert.equal(first.gym_exercise_sets.find((s) => s.set_number === 2).reps, 8);
  assert.equal((await call('/routines', 'PUT', { id, exercises: [
    { name: 'Second exercise', target_reps: '10', sets: [{ weight_kg: 10, reps: 10 }] },
    { name: 'First exercise', target_reps: '6-8', sets: [{ weight_kg: 2.5, reps: 8 }] },
  ] })).status, 200);
  list = await call('/routines');
  const reordered = list.data.routines.find((r) => r.id === id).gym_exercises;
  assert.equal(reordered.find((exercise) => exercise.name === 'Second exercise').sort_order, 0);
  assert.equal(reordered.find((exercise) => exercise.name === 'First exercise').sort_order, 1);
  assert.equal((await call('/routines', 'PUT', { id, exercises: [{ name: 'Invalid', sets: [{ weight_kg: -1, reps: 10 }] }] })).status, 400);
  assert.equal((await call('/routines', 'PUT', { id, exercises: [{ name: 'Invalid target', target_reps: '8-6', sets: [{ weight_kg: 1, reps: 10 }] }] })).status, 400);
  console.log('PASS: target reps, exercise order, decimal KG and validation persisted');
  for (const table of ['forge_accounts', 'forge_sessions', 'forge_login_attempts', 'gym_routines', 'gym_exercises', 'gym_exercise_sets']) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
    assert.ok([401,403].includes(response.status), `Direct access unexpectedly allowed: ${table}`);
  }
  console.log('PASS: all six Forge tables reject direct public access');
} finally {
  secret = '';
  if (created && token) {
    const removed = await call('/routines', 'DELETE', { id });
    assert.equal(removed.status, 200, 'Temporary test routine cleanup failed');
    console.log('PASS: temporary routine and its exercise/sets removed');
  }
  if (token) {
    assert.equal((await call('/logout', 'POST')).status, 200);
    assert.equal((await call('/routines')).status, 401);
    console.log('PASS: logout revokes session');
  }
}
