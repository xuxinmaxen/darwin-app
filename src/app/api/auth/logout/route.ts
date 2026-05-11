/**
 * POST /api/auth/logout — 清掉 cookie
 */

import { NextResponse } from 'next/server';
import { clearLoginCookie } from '@/lib/auth';

export async function POST() {
  await clearLoginCookie();
  return NextResponse.json({ ok: true });
}
