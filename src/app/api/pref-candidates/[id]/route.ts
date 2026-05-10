/**
 * PATCH /api/pref-candidates/[id]   — inline 编辑候选 (仅 pending)
 *
 * body: { iconKey?, category?, body? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCandidate, updateCandidate } from '@/lib/pref-candidates';

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  iconKey: z.enum(['pen', 'eye', 'graph', 'audience', 'flow', 'note']).optional(),
  category: z.string().min(1).max(40).optional(),
  body: z.string().min(1).max(400).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const existing = await getCandidate(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'candidate not found' }, { status: 404 });
  }
  if (existing.status !== 'pending') {
    return NextResponse.json(
      { ok: false, error: `candidate already ${existing.status}` },
      { status: 409 }
    );
  }

  const updated = await updateCandidate(id, parsed);
  revalidatePath(`/projects/${existing.projectId}`);
  return NextResponse.json({ ok: true, candidate: updated });
}
