/**
 * GET /api/health
 *
 * Sanity check: am I configured? Which LLM provider is active?
 * Does NOT actually call external services — keep it cheap.
 */

import { NextResponse } from 'next/server';
import { describeLLM } from '@/lib/llm';

export async function GET() {
  const llm = describeLLM();
  const body = {
    ok: true,
    service: 'darwin',
    version: 'v1.0.0-dev',
    env: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      sqlite: true,
    },
    llm,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
