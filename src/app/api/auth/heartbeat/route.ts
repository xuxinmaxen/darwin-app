/**
 * POST /api/auth/heartbeat
 * Updates current user's last_active_at — used to compute real-time online status.
 * Called by client every 60s from any authenticated page.
 */

import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { bumpLastActive } from '@/lib/employees';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  const jar = await cookies();
  const cookieValue = jar.get(COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.json({ ok: false, error: 'not logged in' }, { status: 401 });
  }
  const id = await currentUserId();
  try {
    await bumpLastActive(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
