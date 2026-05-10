/**
 * GET  /api/threads/:id/messages   — 列 thread 的所有消息 (按时间正序)
 * POST /api/threads/:id/messages   — 发一条消息
 *   body: { body, authorId?, authorKind? }
 *   - 默认 authorId = DEMO_AUTHOR_ID, authorKind = 'human'
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { listMessages, createMessage, getThread } from '@/lib/threads';

const DEMO_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

const Body = z.object({
  body: z.string().min(1).max(4000),
  authorId: z.string().optional(),
  authorKind: z.enum(['human', 'agent', 'system']).optional(),
  isDecision: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const messages = await listMessages(id);
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: threadId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const thread = await getThread(threadId);
  if (!thread) {
    return NextResponse.json(
      { ok: false, error: 'thread not found' },
      { status: 404 }
    );
  }

  try {
    const message = await createMessage({
      threadId,
      authorId: body.authorId ?? DEMO_AUTHOR_ID,
      authorKind: body.authorKind ?? 'human',
      body: body.body,
      isDecision: body.isDecision,
    });

    // fire-and-forget: 让 LLM 看 thread 是否已达成一致 (有 tension 才有意义)
    if (thread.status === 'active' && thread.tensionId && !body.isDecision) {
      setTimeout(() => {
        import('@/lib/detect-consensus')
          .then(m => m.detectConsensusForThread(threadId))
          .then(r => {
            if (r.ok && r.reached) {
              console.info(`[consensus] thread ${threadId} → ${r.selectedKey}`);
            }
          })
          .catch(err => console.warn('[consensus] failed:', err));
      }, 0);
    }

    revalidatePath(`/projects/${thread.projectId}`);
    return NextResponse.json({ ok: true, message }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
