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
    const resolved = await resolveTension({
      tensionId,
      selectedOptionKey: body.selectedOptionKey,
      decidedBy: body.decidedBy ?? [DEMO_AUTHOR_ID],
      threadId: body.threadId ?? null,
    });
    await maybeBackToCollaborating(projectId);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/');
    return NextResponse.json({ ok: true, tension: resolved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
