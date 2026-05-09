/**
 * PATCH  /api/team/prefs/:id   — 编辑共识
 * DELETE /api/team/prefs/:id   — 删除共识
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { updatePref, deletePref } from '@/lib/team-memory';

const Patch = z.object({
  iconKey: z.enum(['pen', 'eye', 'graph', 'audience', 'flow', 'note']).optional(),
  category: z.string().min(1).max(40).optional(),
  body: z.string().min(1).max(2000).optional(),
  source: z.string().min(1).max(40).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let patch: z.infer<typeof Patch>;
  try {
    patch = Patch.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }
  const updated = await updatePref(id, patch);
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'pref not found' }, { status: 404 });
  }
  revalidatePath('/memory');
  return NextResponse.json({ ok: true, pref: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ok = await deletePref(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'pref not found' }, { status: 404 });
  }
  revalidatePath('/memory');
  return NextResponse.json({ ok: true });
}
