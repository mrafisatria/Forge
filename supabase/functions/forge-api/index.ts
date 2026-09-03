import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import { createHandler } from './handler.ts';
import { createPushTransport } from './push-transport.ts';

Deno.serve(createHandler(() => {
  const url = Deno.env.get('SUPABASE_URL');
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try { key = JSON.parse(secretKeys).default || key; }
    catch { /* Fallback ke key server bawaan Supabase. */ }
  }
  if (!url || !key) throw new Error('Missing server configuration');
  return { admin: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), fingerprintKey: key };
}, createPushTransport()));
