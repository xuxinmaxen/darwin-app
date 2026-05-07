/**
 * Server-side Supabase client (Service Role).
 * Bypasses RLS — only use in route handlers / server components.
 * NEVER ship this client's key to the browser.
 */

import { createClient } from '@supabase/supabase-js';

let _admin: ReturnType<typeof createClient> | null = null;

export function supabaseAdmin() {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
