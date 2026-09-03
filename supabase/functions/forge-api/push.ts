import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, object, uuid } from './validation.ts';

export type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushKeys = { publicKey: string; privateKey: string };
export type PushTransport = {
  generateKeys: () => PushKeys;
  send: (subscription: PushSubscriptionData, payload: string, keys: PushKeys) => Promise<number>;
};
type Session = { tokenHash: string; user: { id: string; name: string } };

export async function validateSubscription(value: unknown): Promise<PushSubscriptionData> {
  const data = object(value), keys = object(data.keys);
  if (typeof data.endpoint !== 'string' || data.endpoint.length > 2048) throw new HttpError('Alamat notifikasi tidak valid.', 400);
  let url: URL;
  try { url = new URL(data.endpoint); } catch { throw new HttpError('Alamat notifikasi tidak valid.', 400); }
  // Never send authenticated requests to arbitrary client-supplied URLs (SSRF).
  const allowed = url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com')
    || url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com'
    || url.hostname.endsWith('.push.services.mozilla.com');
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new HttpError('Layanan notifikasi browser ini belum didukung.', 400);
  }
  function bytes(value: unknown, size: number) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new HttpError('Kunci notifikasi tidak valid.', 400);
    let decoded: Uint8Array;
    try { decoded = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)); }
    catch { throw new HttpError('Kunci notifikasi tidak valid.', 400); }
    if (decoded.length !== size) throw new HttpError('Kunci notifikasi tidak valid.', 400);
    return decoded;
  }
  const publicKey = bytes(keys.p256dh, 65);
  bytes(keys.auth, 16);
  try { await crypto.subtle.importKey('raw', new Uint8Array(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
  catch { throw new HttpError('Kunci notifikasi tidak valid.', 400); }
  return { endpoint: url.href, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } };
}

async function settings(admin: SupabaseClient, transport: PushTransport) {
  let { data, error } = await admin.from('forge_push_settings').select('*').eq('id', true).single();
  if (error || !data?.enabled) throw new HttpError('Layanan notifikasi belum tersedia.', 503);
  if (!data.private_key) {
    const keys = transport.generateKeys();
    const write = await admin.from('forge_push_settings').update({ public_key: keys.publicKey, private_key: keys.privateKey }).eq('id', true).is('private_key', null);
    if (write.error) throw write.error;
    ({ data, error } = await admin.from('forge_push_settings').select('*').eq('id', true).single());
    if (error || !data?.private_key) throw new HttpError('Layanan notifikasi belum tersedia.', 503);
  }
  return data as { public_key: string; private_key: string; dispatch_secret: string; enabled: boolean };
}

export async function pushRequest(route: string, method: string, body: Record<string, unknown>, admin: SupabaseClient, session: Session, transport: PushTransport) {
  if (route === '/push/config' && method === 'GET') {
    const config = await settings(admin, transport);
    return { public_key: config.public_key };
  }
  if (route === '/push/subscriptions' && method === 'POST') {
    await settings(admin, transport);
    const subscription = await validateSubscription(body.subscription);
    const { data, error } = await admin.rpc('register_forge_push', {
      p_account: session.user.id, p_session: session.tokenHash, p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh, p_auth: subscription.keys.auth,
    });
    if (error?.code === 'P0001') throw new HttpError('Batas perangkat notifikasi tercapai.', 429);
    if (error?.code === 'P0002') throw new HttpError('Perangkat tidak ditemukan.', 404);
    if (error) throw error;
    return { id: data as string };
  }
  if (route === '/push/subscriptions' && method === 'DELETE') {
    const { error } = await admin.from('forge_push_subscriptions').delete().eq('id', uuid(body.id)).eq('account_id', session.user.id).eq('session_hash', session.tokenHash);
    if (error) throw error;
    return { ok: true };
  }
  if (route === '/push/timer' && method === 'POST') {
    const action = body.action;
    if (!['start', 'cancel', 'presence'].includes(action as string) || typeof body.foreground !== 'boolean') throw new HttpError('Permintaan timer tidak valid.', 400);
    let deadline: string | null = null;
    if (action === 'start') {
      if (![60, 90, 120, 180, 240].includes(body.duration as number)) throw new HttpError('Durasi timer tidak valid.', 400);
      if (typeof body.deadline !== 'number' || !Number.isFinite(body.deadline) || body.deadline > Date.now() + (body.duration as number) * 1000 + 5000 || body.deadline < Date.now() - 10000) throw new HttpError('Waktu timer tidak valid. Periksa jam perangkat.', 400);
      deadline = new Date(body.deadline).toISOString();
    }
    const { data, error } = await admin.rpc('write_forge_timer', {
      p_account: session.user.id, p_session: session.tokenHash, p_subscription: uuid(body.subscription_id),
      p_id: uuid(body.id), p_action: action, p_deadline: deadline, p_foreground: body.foreground,
    });
    if (error?.code === 'P0002') throw new HttpError('Perangkat notifikasi tidak ditemukan. Aktifkan ulang notifikasi.', 404);
    if (error?.code === 'P0001') throw new HttpError('Terlalu banyak timer. Coba lagi nanti.', 429);
    if (error?.code === '22023') throw new HttpError('Waktu timer tidak valid.', 400);
    if (error) throw error;
    return { ok: true, timer: data };
  }
  throw new HttpError('Metode tidak didukung.', 405);
}

export async function dispatchPush(request: Request, admin: SupabaseClient, transport: PushTransport) {
  // No browser bearer token can invoke the dispatcher.
  const supplied = request.headers.get('x-forge-dispatch') ?? '';
  if (request.method !== 'POST' || !/^[0-9a-f]{64}$/.test(supplied)) throw new HttpError('Tidak diizinkan.', 401);
  const { data: config, error } = await admin.from('forge_push_settings').select('*').eq('id', true).single();
  if (error) throw error;
  let mismatch = 0;
  const expected = config?.dispatch_secret ?? '';
  for (let i = 0; i < 64; i++) mismatch |= supplied.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
  if (mismatch || expected.length !== 64) throw new HttpError('Tidak diizinkan.', 401);
  if (!config.enabled || !config.private_key) return { delivered: 0 };
  const { data: timers, error: claimError } = await admin.rpc('claim_forge_timer_notifications');
  if (claimError) throw claimError;
  let delivered = 0;
  for (const timer of timers ?? []) {
    const update = (state: string, retry = false) => admin.from('forge_timer_notifications').update({
      state, claim_id: null, ...(retry ? { retry_at: new Date(Date.now() + 10000).toISOString() } : {}),
    }).eq('id', timer.id).eq('claim_id', timer.claim_id).eq('state', 'sending');
    // Recheck cancellation/logout after the atomic claim and immediately before delivery.
    const { data: current, error: currentError } = await admin.from('forge_timer_notifications').select('id').eq('id', timer.id).eq('claim_id', timer.claim_id).eq('state', 'sending').maybeSingle();
    if (currentError) throw currentError;
    if (!current) continue;
    const { data: subscription, error: subError } = await admin.from('forge_push_subscriptions').select('*').eq('id', timer.subscription_id).eq('account_id', timer.account_id).eq('session_hash', timer.session_hash).maybeSingle();
    if (subError) throw subError;
    if (!subscription) { await update('cancelled'); continue; }
    let status = 0;
    try {
      const safe = await validateSubscription({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } });
      status = await transport.send(safe, JSON.stringify({ type: 'forge-rest-timer', id: timer.id, deadline: timer.deadline }), { publicKey: config.public_key, privateKey: config.private_key });
    } catch { /* Retry transient failures without logging subscription URLs or keys. */ }
    if (status >= 200 && status < 300) { await update('sent'); delivered++; }
    else if (status === 404 || status === 410) {
      await admin.from('forge_push_subscriptions').delete().eq('id', subscription.id).eq('session_hash', timer.session_hash);
    } else await update(timer.attempts >= 3 || (status >= 400 && status < 500 && status !== 429) ? 'failed' : 'pending', true);
  }
  return { delivered };
}
