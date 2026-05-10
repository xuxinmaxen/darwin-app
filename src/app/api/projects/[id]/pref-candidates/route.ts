/**
 * GET /api/projects/[id]/pref-candidates  — 列项目所有 pending 候选
 *
 * UI 用: ProjectShell 在 tension 解决后轮询拉一下,有就弹 toast。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listPendingCandidates } from '@/lib/pref-candidates';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const candidates = await listPendingCandidates(id);
    return NextResponse.json({ ok: true, candidates });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
