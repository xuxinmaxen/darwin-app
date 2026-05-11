/**
 * Darwin — Supabase Postgres client.
 *
 * Server-only. Never import from Client Components.
 * Uses service role key (bypasses RLS). All DB writes go through lib/*.ts helpers.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (_client) return _client;
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Strip any path suffix (e.g. /rest/v1/) — createClient needs base URL only
  const supabaseUrl = rawUrl.replace(/\/(rest|auth|storage|realtime|functions)(\/.*)?$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  _client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  return _client;
}

/** Throw if Supabase response has an error; return data (falling back to [] for arrays). */
export function assertOk<T>(
  result: { data: T | null; error: { message: string } | null }
): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  // For list queries Supabase returns [] (not null) on no rows,
  // but type system says nullable — cast is safe.
  return (result.data ?? []) as NonNullable<T>;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
