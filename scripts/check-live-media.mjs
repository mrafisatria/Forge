// Checks live auth, gallery access, and invalid uploads without creating media/routines.
import assert from 'node:assert/strict';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Missing Supabase configuration');
let secret = '';
for await (const chunk of process.stdin) secret += chunk;
let token;
async function call(path, method = 'GET', body) {
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${url}/functions/v1/forge-api${path}`, {
    method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, data: await response.json() };
}
try {
  assert.equal((await call('/media')).status, 401);
  const session = await call('/login', 'POST', { secret_key: secret.trim() });
  secret = '';
  assert.equal(session.status, 200); token = session.data.session_token;
  const gallery = await call('/media');
  assert.equal(gallery.status, 200, gallery.data.error);
  assert.ok(Array.isArray(gallery.data.media));
  assert.ok(gallery.data.media.every((item) => item.image_path.startsWith(session.data.user.id + '/') && item.image_url));
  assert.equal((await call('/routines')).status, 200);
  for (const type of ['image/png', 'video/mp4']) {
    const form = new FormData(); form.append('file', new File(['not a valid media file'], 'invalid', { type }));
    assert.equal((await call('/media', 'POST', form)).status, 400);
  }
  assert.equal((await call('/media?offset=-1')).status, 400);
  const direct = await fetch(`${url}/rest/v1/forge_media?select=id&limit=1`, { headers: { apikey: key } });
  assert.ok([401, 403].includes(direct.status));
  console.log('PASS: authenticated gallery and existing routines load; invalid uploads and direct public table access rejected.');
  console.log('No media or routines were created or modified.');
} finally {
  secret = '';
  if (token) { assert.equal((await call('/logout', 'POST')).status, 200); console.log('PASS: test session revoked.'); }
}
