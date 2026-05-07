/**
 * Browser-side Supabase client.
 * Uses anon key — only respects RLS policies.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// V1: no generated DB types yet — let queries accept any column shape.
// Phase 2 will run `supabase gen types typescript` and tighten this.
let _client: SupabaseClient | null = null;

export function supabaseBrowser() {
  if (_client) return _client;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    .trim()
    .replace(/\/rest\/v1\/?$/, '') // tolerate user pasting full REST endpoint
    .replace(/\/+$/, '');           // tolerate trailing slash
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
    );
  }
  _client = createClient(url, key);
  return _client;
}
