import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, object, uuid, metadata, exercises, secret, imageExtension } from './validation.ts';
import { validateMedia, VIDEO_LIMIT } from './media-validation.ts';
import { dispatchPush, pushRequest, type PushTransport } from './push.ts';

const BUCKET = 'forge-exercise-images';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(request: Request) {
  // Reject oversized bodies without first buffering the entire request.
  const raw = await readBody(request, 1024 * 1024);
  try { return object(JSON.parse(new TextDecoder().decode(raw))); }
  catch { throw new HttpError('Format data tidak valid.', 400); }
}

async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError('Ukuran permintaan terlalu besar.', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError('Ukuran permintaan terlalu besar.', 413); }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function authenticate(request: Request, admin: SupabaseClient) {
  const header = request.headers.get('authorization') ?? '';
  if (!/^Bearer forge_[A-Za-z0-9_-]{43}$/.test(header)) throw new HttpError('Sesi tidak valid. Silakan masuk kembali.', 401);
  const tokenHash = await sha256(header.slice(7));
  const { data: session, error } = await admin.from('forge_sessions').select('account_id,expires_at').eq('token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!session || Date.parse(session.expires_at) <= Date.now() || !Number.isFinite(Date.parse(session.expires_at))) {
    throw new HttpError('Sesi sudah berakhir. Silakan masuk kembali.', 401);
  }
  const { data: account, error: accountError } = await admin.from('forge_accounts').select('id,name,active').eq('id', session.account_id).maybeSingle();
  if (accountError) throw accountError;
  if (!account?.active || account.name !== 'Rafi') throw new HttpError('Akun tidak tersedia.', 401);
  return { tokenHash, user: { id: account.id as string, name: 'Rafi' } };
}

async function login(request: Request, admin: SupabaseClient, fingerprintKey: string) {
  const body = await readJson(request);
  const candidate = secret(body.secret_key);
  // The gateway supplies the real IP. Account-wide bucket also bounds attacks
  // if forwarded headers are missing/spoofed or many IP addresses are used.
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const fingerprint = await sha256(`${fingerprintKey}:forge:${ip}`);
  const globalFingerprint = await sha256(`${fingerprintKey}:forge:account-limit`);
  for (const [key, max] of [[fingerprint, 8], [globalFingerprint, 40]] as const) {
    const { data: allowed, error } = await admin.rpc('reserve_forge_login_attempt', { p_fingerprint: key, p_max: max });
    if (error) throw error;
    if (!allowed) throw new HttpError('Terlalu banyak percobaan. Coba lagi dalam 15 menit.', 429);
  }
  const { data: account, error } = await admin.rpc('verify_forge_account', { candidate_secret: candidate }).maybeSingle<{ account_id: string; account_name: string }>();
  if (error) throw error;
  if (!account || account.account_name !== 'Rafi') throw new HttpError('Secret key tidak dikenali.', 401);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = 'forge_' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  const { error: sessionError } = await admin.from('forge_sessions').insert({ token_hash: await sha256(token), account_id: account.account_id, expires_at: expiresAt });
  if (sessionError) throw sessionError;
  // Best-effort expiry cleanup never touches Dompetku sessions.
  await admin.from('forge_sessions').delete().lt('expires_at', new Date().toISOString());
  return json({ session_token: token, expires_at: expiresAt, user: { id: account.account_id, name: 'Rafi' } });
}

const routineColumns = 'id,name,training_day,note,created_at,gym_exercises(id,name,image_path,sort_order,gym_exercise_sets(id,set_number,weight_kg,reps))';

async function listRoutines(admin: SupabaseClient, owner: string) {
  const { data, error } = await admin.from('gym_routines').select(routineColumns).eq('user_id', owner).order('created_at', { ascending: false });
  if (error) throw error;
  const routines = data ?? [];
  const paths = [...new Set(routines.flatMap((routine) => routine.gym_exercises.map((exercise) => exercise.image_path as string | null)).filter((path): path is string => Boolean(path)))];
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (signError) throw signError;
    for (const image of signed ?? []) if (image.path && image.signedUrl) urls.set(image.path, image.signedUrl);
  }
  return routines.map((routine) => ({ ...routine, gym_exercises: routine.gym_exercises.map((exercise) => ({ ...exercise, image_url: urls.get(exercise.image_path) ?? null })) }));
}

async function routines(request: Request, admin: SupabaseClient, user: { id: string; name: string }) {
  if (request.method === 'GET') return json({ routines: await listRoutines(admin, user.id), user });
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) throw new HttpError('Metode tidak didukung.', 405);
  const body = await readJson(request);
  const id = uuid(body.id);
  if (request.method === 'POST' || request.method === 'PUT') {
    const items = exercises(body.exercises, user.id, id);
    const reusablePaths = [...new Set(items.map((item) => item.image_path).filter((path): path is string => Boolean(path) && !path!.startsWith(`${user.id}/${id}/`)))];
    if (reusablePaths.length) {
      const { data: owned, error: mediaError } = await admin.from('forge_media').select('image_path').eq('user_id', user.id).in('image_path', reusablePaths);
      if (mediaError) throw mediaError;
      if (reusablePaths.some((path) => !owned?.some((item) => item.image_path === path))) throw new HttpError('Media tidak ditemukan di galeri akun ini.', 400);
    }
    const info = request.method === 'POST' ? metadata(body) : null;
    const { error } = await admin.rpc('write_forge_routine', {
      p_user_id: user.id, p_routine_id: id, p_create: request.method === 'POST',
      p_name: info?.name ?? null, p_training_day: info?.training_day ?? null, p_note: info?.note ?? null, p_exercises: items,
    });
    if (error?.code === 'P0002') throw new HttpError('Routine tidak ditemukan.', 404);
    if (error?.code === '23505') throw new HttpError('Routine sudah tersimpan. Muat ulang daftar routine.', 409);
    if (error) throw error;
    return json({ ok: true, id }, request.method === 'POST' ? 201 : 200);
  }
  const query = request.method === 'PATCH'
    ? admin.from('gym_routines').update({ ...metadata(body), updated_at: new Date().toISOString() })
    : admin.from('gym_routines').delete();
  const { data, error } = await query.eq('id', id).eq('user_id', user.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError('Routine tidak ditemukan.', 404);
  return json({ ok: true, id });
}

async function upload(request: Request, admin: SupabaseClient, owner: string) {
  const raw = await readBody(request, 5 * 1024 * 1024 + 64 * 1024);
  let form: FormData;
  try { form = await new Response(raw, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData(); }
  catch { throw new HttpError('Format upload tidak valid.', 400); }
  const routineId = uuid(form.get('routine_id'));
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError('Pilih foto exercise.', 400);
  const extension = await imageExtension(file);
  const { data: routine, error: lookupError } = await admin.from('gym_routines').select('user_id').eq('id', routineId).maybeSingle();
  if (lookupError) throw lookupError;
  if (routine && routine.user_id !== owner) throw new HttpError('Routine tidak ditemukan.', 404);
  // A new routine may not exist yet; its path is still restricted to this account.
  const path = `${owner}/${routineId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { error: registerError } = await admin.from('forge_media').insert({
    user_id: owner, name: file.name.slice(0, 180) || 'Foto exercise', image_path: path,
    kind: 'image', mime_type: file.type, size_bytes: file.size,
  });
  if (registerError) throw registerError;
  const { data, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (signedError) throw signedError;
  return json({ image_path: path, image_url: data.signedUrl }, 201);
}

const mediaColumns = 'id,name,image_path,kind,mime_type,size_bytes,duration_seconds,created_at';

async function signedMedia(admin: SupabaseClient, items: { image_path: string; [key: string]: unknown }[]) {
  if (!items.length) return [];
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(items.map((item) => item.image_path), 3600);
  if (error) throw error;
  const urls = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
  return items.map((item) => ({ ...item, image_url: urls.get(item.image_path) ?? null }));
}

async function media(request: Request, admin: SupabaseClient, owner: string) {
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const offset = Number(params.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new HttpError('Halaman tidak valid.', 400);
    const search = (params.get('q') ?? '').trim().slice(0, 100).replace(/[%_\\]/g, '');
    let query = admin.from('forge_media').select(mediaColumns).eq('user_id', owner);
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + 60);
    if (error) throw error;
    return json({ media: await signedMedia(admin, (data ?? []).slice(0, 60)), next_offset: (data?.length ?? 0) > 60 ? offset + 60 : null });
  }
  if (request.method !== 'POST') throw new HttpError('Metode tidak didukung.', 405);
  const raw = await readBody(request, VIDEO_LIMIT + 64 * 1024);
  let form: FormData;
  try { form = await new Response(raw, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData(); }
  catch { throw new HttpError('Format upload tidak valid.', 400); }
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError('Pilih gambar atau video.', 400);
  const info = await validateMedia(file);
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const lookup = () => admin.from('forge_media').select(mediaColumns).eq('user_id', owner).eq('content_hash', hash).maybeSingle();
  const { data: existing, error: lookupError } = await lookup();
  if (lookupError) throw lookupError;
  if (existing) return json({ media: (await signedMedia(admin, [existing]))[0], reused: true });
  const id = crypto.randomUUID();
  const path = `${owner}/library/${id}.${info.extension}`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;
  const row = {
    id, user_id: owner, name: file.name.slice(0, 180) || 'Media exercise', image_path: path,
    kind: info.kind, mime_type: file.type, size_bytes: file.size, duration_seconds: info.duration, content_hash: hash,
  };
  const { data: saved, error: saveError } = await admin.from('forge_media').insert(row).select(mediaColumns).single();
  if (saveError) {
    // Compensate only for the object created by this request, never a user's existing asset.
    await admin.storage.from(BUCKET).remove([path]);
    if (saveError.code === '23505') {
      const { data: duplicate, error } = await lookup();
      if (!error && duplicate) return json({ media: (await signedMedia(admin, [duplicate]))[0], reused: true });
    }
    throw saveError;
  }
  return json({ media: (await signedMedia(admin, [saved]))[0], reused: false }, 201);
}

export function createHandler(getAdmin: () => { admin: SupabaseClient; fingerprintKey: string }, pushTransport?: PushTransport) {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    try {
      const parts = new URL(request.url).pathname.split('/').filter(Boolean);
      const functionIndex = parts.lastIndexOf('forge-api');
      const route = functionIndex < 0 ? '' : '/' + parts.slice(functionIndex + 1).join('/');
      if (!['/login', '/logout', '/routines', '/images', '/media', '/push/config', '/push/subscriptions', '/push/timer', '/push/dispatch'].includes(route)) throw new HttpError('Endpoint tidak ditemukan.', 404);
      if (['/login', '/logout', '/images'].includes(route) && request.method !== 'POST') throw new HttpError('Metode tidak didukung.', 405);
      const { admin, fingerprintKey } = getAdmin();
      if (route === '/push/dispatch') {
        if (!pushTransport) throw new HttpError('Layanan notifikasi belum tersedia.', 503);
        return json(await dispatchPush(request, admin, pushTransport));
      }
      if (route === '/login') return await login(request, admin, fingerprintKey);
      const session = await authenticate(request, admin);
      if (route.startsWith('/push/')) {
        if (!pushTransport) throw new HttpError('Layanan notifikasi belum tersedia.', 503);
        return json(await pushRequest(route, request.method, request.method === 'GET' ? {} : await readJson(request), admin, session, pushTransport));
      }
      if (route === '/logout') {
        const { error } = await admin.from('forge_sessions').delete().eq('token_hash', session.tokenHash);
        if (error) throw error;
        return json({ ok: true });
      }
      if (route === '/images') return await upload(request, admin, session.user.id);
      if (route === '/media') return await media(request, admin, session.user.id);
      return await routines(request, admin, session.user);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Never log request bodies, credentials, or bearer tokens.
      console.error('Forge request failed', typeof error === 'object' && error !== null && 'code' in error ? error.code : 'internal');
      return json({ error: 'Layanan Forge sedang bermasalah. Silakan coba lagi.' }, 500);
    }
  };
}
