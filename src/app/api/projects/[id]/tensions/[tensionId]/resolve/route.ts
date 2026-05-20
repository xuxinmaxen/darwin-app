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

import { NextRequest, NextResponse, after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { resolveTension, getTension } from '@/lib/tensions';
import { maybeBackToCollaborating } from '@/lib/detect-tension';
import {
  findThreadByTension,
  resolveThread,
  createMessage,
} from '@/lib/threads';
import { currentUserId } from '@/lib/auth';

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

    const deciderId = await currentUserId();
    const resolved = await resolveTension({
      tensionId,
      selectedOptionKey: body.selectedOptionKey,
      decidedBy: body.decidedBy ?? [deciderId],
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

    // fire-and-forget: 让 LLM 看决议+讨论, 决定要不要弹"沉淀为团队共识"候选
    // 用 after() 而不是 setTimeout, 见 intents/route.ts 注释 (Vercel serverless freeze)。
    after(async () => {
      try {
        const m = await import('@/lib/extract-pref-candidate');
        const r = await m.extractPrefCandidateForTension(tensionId);
        if (!r.ok) console.warn('[extract-pref] failed:', r.error);
      } catch (err) {
        console.warn('[extract-pref] threw:', err);
      }
    });

    // fire-and-forget: 冲突复盘 + agent 主动观察
    //   1. 复盘 (retrospect): 给所有 owner 看, 落 tension.resolution.retrospect, 也喂 timeline
    //   2. 观察 (observe): 仅冲突涉及的 agent 触发, 让它从整个项目角度补一刀
    // 顺序: 先 retrospect (latency 短一些), 后 observe (会读取 tension.resolution 含 retrospect 后的状态)
    after(async () => {
      try {
        const retroMod = await import('@/lib/tension-retrospect');
        await retroMod.generateRetrospect(tensionId).then(r => {
          if (!r.ok) console.warn('[retrospect] failed:', r.error);
        });
      } catch (err) {
        console.warn('[retrospect] threw:', err);
      }

      try {
        const { getIntent } = await import('@/lib/intents');
        const observeMod = await import('@/lib/agent-observe');
        // 冲突涉及的 intent → 拿出 agent 作者 → 各自 observe
        const tensionIntents = await Promise.all(tension.intentIds.map(getIntent));
        const agentIds = new Set<string>();
        for (const it of tensionIntents) {
          if (it && it.authorKind === 'agent') agentIds.add(it.authorId);
        }
        if (agentIds.size > 0) {
          await Promise.allSettled(
            [...agentIds].map(aid =>
              observeMod.observeProject(aid, projectId, tensionId).catch(err =>
                console.warn(`[observe] (${aid}) failed:`, err)
              )
            )
          );
        }
      } catch (err) {
        console.warn('[observe] threw:', err);
      }
    });

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
