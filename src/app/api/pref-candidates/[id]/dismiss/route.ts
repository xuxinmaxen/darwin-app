/**
 * POST /api/pref-candidates/[id]/dismiss
 *
 * 弃用候选 (不沉淀)。状态改 dismissed, 候选保留 (可以未来反向看团队拒绝过什么)。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { dismissCandidate, getCandidate } from '@/lib/pref-candidates';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
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
  const updated = await dismissCandidate(id);
  revalidatePath(`/projects/${existing.projectId}`);
  return NextResponse.json({ ok: true, candidate: updated });
}
