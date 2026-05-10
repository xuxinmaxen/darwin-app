/**
 * POST /api/pref-candidates/[id]/accept
 *
 * 把候选沉淀为 team_prefs 一条共识 + 标记候选 accepted。
 *
 * body 可选: { iconKey?, category?, body? } — 若用户在 toast 里小幅改了再沉淀
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCandidate, markAccepted, updateCandidate } from '@/lib/pref-candidates';
import { createPref } from '@/lib/team-memory';
import { getEmployee } from '@/lib/employees';

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  iconKey: z.enum(['pen', 'eye', 'graph', 'audience', 'flow', 'note']).optional(),
  category: z.string().min(1).max(40).optional(),
  body: z.string().min(1).max(400).optional(),
}).optional();

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let patch: z.infer<typeof Body> = undefined;
  try {
    const text = await req.text();
    if (text) patch = Body.parse(JSON.parse(text));
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

  // 用户可能小幅改: 先把改写回候选 (审计可追溯), 再用最终值写共识
  const merged = patch ? (await updateCandidate(id, patch)) ?? existing : existing;

  // 来源: 用 owner 员工的 cls 作为 sourceCls (头像配色). 找不到就 'xu'.
  const owner = await getEmployee(merged.ownerId).catch(() => null);
  const sourceCls = owner?.cls ?? 'xu';
  const sourceLabel = merged.sourceHint || (owner?.name ? `${owner.name}` : '团队');

  const pref = await createPref({
    ownerId: merged.ownerId,
    iconKey: merged.iconKey,
    category: merged.category,
    body: merged.body,
    source: sourceLabel,
    sourceCls,
  });

  await markAccepted(id, pref.id);

  revalidatePath(`/projects/${merged.projectId}`);
  revalidatePath('/memory');
  revalidatePath('/');
  return NextResponse.json({ ok: true, pref, candidateId: id });
}
