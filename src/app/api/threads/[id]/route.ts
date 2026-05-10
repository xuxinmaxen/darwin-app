/**
 * PATCH /api/threads/[id]   — 改 thread 状态 (目前只支持 active → resolved)
 *
 * 用户主动开的 thread 没关联 tension, 没有"决议方案"概念,
 * 但讨论本身可以"已经聊到位了"。让团队显式收敛, 同时写一条 system 收敛消息。
 *
 * Tension 关联的 thread 不要走这条路径 — 它们在 /tensions/.../resolve 里被 resolve。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getThread, resolveThread, createMessage } from '@/lib/threads';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const thread = await getThread(id);
  if (!thread) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, thread });
}

const Body = z.object({
  status: z.enum(['resolved']),
  closingNote: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const thread = await getThread(id);
  if (!thread) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }
  if (thread.status === 'resolved') {
    return NextResponse.json({ ok: true, thread, alreadyResolved: true });
  }
  if (thread.tensionId) {
    return NextResponse.json(
      { ok: false, error: '关联 tension 的 thread 请走 /resolve 决议' },
      { status: 400 }
    );
  }

  // 写 system 收敛消息 (有 closingNote 用它, 否则给个默认句)
  await createMessage({
    threadId: id,
    authorId: 'system',
    authorKind: 'system',
    body: body.closingNote?.trim() || '✓ 团队标记此讨论已收敛。',
    isDecision: true,
  });
  const updated = await resolveThread(id);

  revalidatePath(`/projects/${thread.projectId}`);
  return NextResponse.json({ ok: true, thread: updated });
}
