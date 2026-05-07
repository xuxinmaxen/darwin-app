/**
 * GET /api/health
 *
 * Sanity check: am I configured? Does Claude/Supabase env exist?
 * Does NOT actually call external services — keep it cheap.
 */

import { NextResponse } from 'next/server';
import { describeClaudeConfig } from '@/lib/claude';
import type { HealthResponse } from '@/lib/types';

export async function GET() {
  const body: HealthResponse = {
    ok: true,
    service: 'darwin',
    version: 'v1.0.0-dev',
    env: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
          process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
    },
    claude: describeClaudeConfig(),
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
