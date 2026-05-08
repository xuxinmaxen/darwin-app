/**
 * /api/projects/[id]/intents
 *
 * GET   — list all intents for a project (asc by createdAt)
 * POST  — create a new intent for a project
 *
 * V1: type/scope/weight default to Goal/global/should if not provided.
 * Phase 3: POST will internally call /api/extract first to fill these.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { listIntentsByProject, createIntent } from '@/lib/intents';
import { bumpToCollaborating } from '@/lib/projects';

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
  try {
    const intent = await createIntent({
      projectId,
      authorId: DEMO_AUTHOR_ID,
      authorKind: body.authorKind,
      statement: body.statement,
      type: body.type,
      scope: body.scope,
      weight: body.weight,
      rationale: body.rationale,
    });
    // Auto-promote: 第一条 Intent 落地时把项目从 draft 推到 collaborating
    // (no-op if status 已经不是 draft)
    await bumpToCollaborating(projectId).catch(() => {
      // 状态推进失败不影响主流程,后台日志即可
    });
    revalidatePath('/');
    revalidatePath(`/projects/${projectId}`);
    return NextResponse.json({ ok: true, intent }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
