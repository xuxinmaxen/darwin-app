/**
 * Server-side Supabase client (Service Role).
 * Bypasses RLS — only use in route handlers / server components.
 * NEVER ship this client's key to the browser.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// V1: no generated DB types yet — let queries accept any column shape.
// Phase 2 will run `supabase gen types typescript` and tighten this.
let _admin: SupabaseClient | null = null;

export function supabaseAdmin() {
  if (_admin) return _admin;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    .trim()
    .replace(/\/rest\/v1\/?$/, '') // tolerate user pasting full REST endpoint
    .replace(/\/+$/, '');           // tolerate trailing slash
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase admin env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }
  _admin = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _admin;
}
