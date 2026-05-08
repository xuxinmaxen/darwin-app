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

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { listIntentsByProject, createIntent } from '@/lib/intents';
import { bumpToCollaborating, getProject } from '@/lib/projects';
import { tryExtractIntent } from '@/lib/extract';

type Params = { params: Promise<{ id: string }> };

/** Phase 2: replace with Supabase Auth user id */
const DEMO_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

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
  statement: z.string().min(1, 'statement cannot be empty').max(2000),
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
    const intent = await createIntent({
      projectId,
      authorId: DEMO_AUTHOR_ID,
      authorKind: body.authorKind,
      statement: body.statement,
      type: resolvedType,
      scope: resolvedScope,
      weight: resolvedWeight,
      rationale: resolvedRationale,
    });
    await bumpToCollaborating(projectId).catch(() => {});
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
