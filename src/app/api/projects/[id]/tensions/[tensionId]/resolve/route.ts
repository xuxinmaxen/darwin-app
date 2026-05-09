/**
 * POST /api/projects/[id]/tensions/[tensionId]/resolve
 *
 * Body: { selectedOptionKey: 'A' | 'B' | 'C' | string, decidedBy?: string[], threadId?: string | null }
 *
 * 副作用:
 *   - tension.status = 'resolved'
 *   - 如果该项目没其他 active tension → project.status 推回 'collaborating'
 *
 * 不在这里直接重合成: 由前端在 resolve 成功后通知 ProjectCanvas 触发重合成 (用现有 hook)。
 * 这样保持 API 单一职责。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { resolveTension, getTension } from '@/lib/tensions';
import { maybeBackToCollaborating } from '@/lib/detect-tension';
import {
  findThreadByTension,
  resolveThread,
  createMessage,
} from '@/lib/threads';

const DEMO_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

const Body = z.object({
  selectedOptionKey: z.string().min(1).max(40),
  decidedBy: z.array(z.string()).optional(),
  threadId: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string; tensionId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: projectId, tensionId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const tension = await getTension(tensionId);
  if (!tension || tension.projectId !== projectId) {
    return NextResponse.json(
      { ok: false, error: 'tension not found in this project' },
      { status: 404 }
    );
  }

  // 校验 selectedOptionKey 在 options 列表里
  const validKey =
    body.selectedOptionKey === 'custom' ||
    tension.options.some(o => o.key === body.selectedOptionKey);
  if (!validKey) {
    return NextResponse.json(
      { ok: false, error: `selectedOptionKey "${body.selectedOptionKey}" 不在 options 里` },
      { status: 400 }
    );
  }

  try {
    // 找关联 thread (如果通过"开讨论"路径过来 + body 没显式传)
    let threadId = body.threadId ?? null;
    if (!threadId) {
      const thread = await findThreadByTension(tensionId);
      if (thread) threadId = thread.id;
    }

    const resolved = await resolveTension({
      tensionId,
      selectedOptionKey: body.selectedOptionKey,
      decidedBy: body.decidedBy ?? [DEMO_AUTHOR_ID],
      threadId,
    });
    await maybeBackToCollaborating(projectId);

    // 关联 thread 也 resolve + 写决策消息
    if (threadId) {
      const selectedOption = tension.options.find(
        o => o.key === body.selectedOptionKey
      );
      const optionTitle = selectedOption?.title ?? body.selectedOptionKey;
      await createMessage({
        threadId,
        authorId: 'system',
        authorKind: 'system',
        body: `✓ 决议: 选定方案 **${body.selectedOptionKey}** · ${optionTitle}`,
        isDecision: true,
        decisionPayload: { selectedOptionKey: body.selectedOptionKey },
      });
      await resolveThread(threadId);
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/');
    return NextResponse.json({ ok: true, tension: resolved, threadId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
