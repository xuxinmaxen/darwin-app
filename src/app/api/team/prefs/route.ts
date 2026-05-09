/**
 * GET  /api/team/prefs        — 列共识
 * POST /api/team/prefs        — 新增共识
 *   body: { iconKey, category, body, source?, sourceCls? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { listPrefs, createPref } from '@/lib/team-memory';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

const Body = z.object({
  iconKey: z.enum(['pen', 'eye', 'graph', 'audience', 'flow', 'note']),
  category: z.string().min(1).max(40),
  body: z.string().min(1).max(2000),
  source: z.string().min(1).max(40).optional(),
  sourceCls: z.string().min(1).max(40).optional(),
});

export async function GET() {
  try {
    const prefs = await listPrefs(DEMO_OWNER_ID);
    return NextResponse.json({ ok: true, prefs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }
  try {
    const pref = await createPref({
      ownerId: DEMO_OWNER_ID,
      iconKey: body.iconKey,
      category: body.category,
      body: body.body,
      source: body.source ?? '徐鑫',
      sourceCls: body.sourceCls ?? 'xu',
    });
    revalidatePath('/memory');
    return NextResponse.json({ ok: true, pref }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
