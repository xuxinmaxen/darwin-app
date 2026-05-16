/**
 * /api/projects/[id]/intents
 *
 * GET   — list all intents for a project (asc by createdAt)
 * POST  — create a new intent for a project
 *
 * POST 流程:
 *   1. 试 Claude 抽取 (lib/extract.ts) 把 statement → {type, scope, weight, rationale}
 *   2. Claude 失败 / 没 key → 回退默认 (Goal/global/should)
 *   3. 不论哪条路径,intent 都会落库
 *
 * 客户端不需要传 type/scope/weight,默认服务端补。如果 client 显式传了,以 client 为准。
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { listIntentsByProject, createIntent } from '@/lib/intents';
import { bumpToCollaborating, getProject } from '@/lib/projects';
import { tryExtractIntent } from '@/lib/extract';
import { detectTensionsForProject } from '@/lib/detect-tension';
import { currentUserId } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const intents = await listIntentsByProject(id);
    return NextResponse.json({ ok: true, intents });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

const CreateBody = z.object({
  /* 50000 字上限留给"附件正文 + 用户原文"拼接场景 (单条 Intent 可能包含
   * 8000 字的文件参考内容)。LLM 上下文够用, SQLite TEXT 也没限制。 */
  statement: z.string().min(1, 'statement cannot be empty').max(50_000),
  type: z
    .enum(['Goal', 'Constraint', 'Preference', 'Reference', 'Veto'])
    .optional(),
  scope: z.string().max(60).optional(),
  weight: z.enum(['must', 'should', 'nice_to_have']).optional(),
  rationale: z.string().max(1000).optional(),
  authorKind: z.enum(['human', 'agent']).default('human'),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid request: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 }
    );
  }

  // 1. 试 Claude 抽取 (仅在 client 没显式给 type 时才试,省调用次数)
  let extractSource: 'llm' | 'default' = 'default';
  let extractReason: string | undefined;
  let resolvedType = body.type;
  let resolvedScope = body.scope;
  let resolvedWeight = body.weight;
  let resolvedRationale = body.rationale ?? null;

  if (!body.type) {
    const project = await getProject(projectId);
    if (project) {
      const outcome = await tryExtractIntent({
        statement: body.statement,
        projectType: project.type,
        projectBackground: project.background,
      });
      if (outcome.ok) {
        extractSource = 'llm';
        resolvedType = outcome.intent.type;
        resolvedScope = outcome.intent.scope;
        resolvedWeight = outcome.intent.weight;
        resolvedRationale = outcome.intent.rationale ?? null;
      } else {
        extractReason = outcome.reason;
      }
    }
  }

  try {
    const authorId = await currentUserId();
    const intent = await createIntent({
      projectId,
      authorId,
      authorKind: body.authorKind,
      statement: body.statement,
      type: resolvedType,
      scope: resolvedScope,
      weight: resolvedWeight,
      rationale: resolvedRationale,
    });
    await bumpToCollaborating(projectId).catch(() => {});

    // must / should / Veto-type 都可能引发对立 (Veto 顶撞 should 也算).
    // nice_to_have 不触发, 避免无谓 LLM 调用.
    // 用 next/server 的 after() 而不是 setTimeout: Vercel serverless 在 response 发出后会冻结 function,
    // setTimeout 里的 LLM 调用根本跑不完。after() 是 Next.js 专门给这种场景的 API。
    if (resolvedWeight === 'must' || resolvedWeight === 'should' || intent.type === 'Veto') {
      after(async () => {
        try {
          await detectTensionsForProject(projectId);
        } catch (err) {
          console.warn('[detect-tension] failed:', err);
        }
      });
    }

    revalidatePath('/');
    revalidatePath(`/projects/${projectId}`);
    return NextResponse.json(
      {
        ok: true,
        intent,
        extractSource,
        ...(extractReason ? { extractReason } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
