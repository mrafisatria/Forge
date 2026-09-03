import type { Routine } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(supabaseUrl && publishableKey);
export const sessionStorageKey = 'forge_app_session';

export type ForgeUser = { id: string; name: 'Rafi' };
export type ForgeSession = { session_token: string; expires_at: string; user: ForgeUser };
export type RoutinesResponse = { routines: Routine[]; user: ForgeUser };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options: {
  method?: string; token?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean;
} = {}): Promise<T> {
  if (!isSupabaseConfigured) throw new ApiError('Koneksi Supabase belum dikonfigurasi.', 503);
  const headers: Record<string, string> = { apikey: publishableKey! };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const isForm = options.body instanceof FormData;
  if (!isForm) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${supabaseUrl}/functions/v1/forge-api${path}`, {
    method: options.method ?? 'GET', headers, cache: 'no-store', signal: options.signal, keepalive: options.keepalive,
    body: options.body === undefined ? undefined : isForm ? options.body as FormData : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.error || 'Layanan Forge belum dapat memproses permintaan.', response.status);
  }
  return payload as T;
}

export function readSession(): ForgeSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(sessionStorageKey) ?? 'null');
    if (value?.user?.name === 'Rafi' && typeof value.session_token === 'string'
      && value.session_token.startsWith('forge_') && Date.parse(value.expires_at) > Date.now()) return value;
    window.localStorage.removeItem(sessionStorageKey);
  } catch { /* Storage dapat dinonaktifkan oleh browser. */ }
  return null;
}

export function rememberSession(session: ForgeSession | null) {
  try {
    if (session) window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
    else window.localStorage.removeItem(sessionStorageKey);
  } catch { /* Login tetap berlaku untuk tab ini bila storage tidak tersedia. */ }
}
