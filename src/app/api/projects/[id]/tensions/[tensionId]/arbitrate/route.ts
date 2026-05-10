/**
 * POST /api/projects/[id]/tensions/[tensionId]/arbitrate
 *
 * 手动触发 AI 仲裁 — 给定 tension, 让 LLM 评分三个方案 + 选最佳 +
 * 写决策消息 + resolveTension。
 *
 * conflictMode === 'ai_decide' 时, detect-tension 已经 fire-and-forget 自动跑过。
 * 这个端点用作:
 *   - 用户在 TensionCard 上手动点 "让 AI 评分决策"
 *   - 自动仲裁失败后的人工重试
 *
 * 幂等: tension 已 resolved → 直接返回 selectedKey, 不重复扣 LLM。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { arbitrateTension } from '@/lib/arbitrate-tension';
import { getTension } from '@/lib/tensions';

type Params = { params: Promise<{ id: string; tensionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: projectId, tensionId } = await params;

  const tension = await getTension(tensionId);
  if (!tension || tension.projectId !== projectId) {
    return NextResponse.json(
      { ok: false, error: 'tension not found in this project' },
      { status: 404 }
    );
  }

  const result = await arbitrateTension(tensionId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 }
    );
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/');
  return NextResponse.json({
    ok: true,
    selectedKey: result.selectedKey,
    decisionSummary: result.decisionSummary,
    scores: result.scores,
  });
}
