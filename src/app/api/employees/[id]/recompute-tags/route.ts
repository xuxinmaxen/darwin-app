/**
 * POST /api/employees/[id]/recompute-tags
 *
 * 让 LLM 重新计算这个 agent 的学习 tag。
 * 一般由 /memory 页面在加载时为 tags 缺失/过期的 agent 自动调用。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recomputeAgentTags } from '@/lib/agent-tags';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const result = await recomputeAgentTags(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  revalidatePath('/memory');
  return NextResponse.json({
    ok: true,
    tags: result.tags,
    intentCount: result.intentCount,
    skipped: result.skipped,
  });
}
