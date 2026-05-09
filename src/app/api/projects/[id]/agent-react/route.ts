/**
 * POST /api/projects/[id]/agent-react
 *
 * Body: { agentEmployeeId, triggerIntentId }
 *
 * 让一个 Agent 协作者「看到」某条触发 Intent 后,自己判断是否要接话。
 * 主体逻辑在 lib/agent-react.ts (因为也用于 chain fan-out)。
 *
 * 行为:
 *   - 不强制发言: shouldSpeak=false 时返回 ok=true + reaction='silent'
 *   - self-trigger 自动 silent
 *   - chain depth > MAX_CHAIN_DEPTH 时强制 silent (防 agent 接话无限链)
 *   - spoke 时会 fire-and-forget 触发其他 Agent 协作者再判断
 *
 * 返回:
 *   { ok: true, reaction: 'spoke', intent: {...} }
 *   { ok: true, reaction: 'silent', reason: '...' }
 *   { ok: false, error: '...' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { reactOnce } from '@/lib/agent-react';

const Body = z.object({
  agentEmployeeId: z.string().min(1),
  triggerIntentId: z.string().min(1),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const out = await reactOnce({
    projectId,
    agentEmployeeId: body.agentEmployeeId,
    triggerIntentId: body.triggerIntentId,
  });

  if (!out.ok) {
    return NextResponse.json(
      { ok: false, error: out.error },
      { status: out.status }
    );
  }

  if (out.reaction === 'spoke') {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/');
    return NextResponse.json(
      { ok: true, reaction: 'spoke', intent: out.intent },
      { status: 201 }
    );
  }

  return NextResponse.json({
    ok: true,
    reaction: 'silent',
    reason: out.reason,
  });
}
