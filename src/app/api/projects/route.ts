/**
 * /api/projects
 *
 * GET   — list all projects for the (demo) owner
 * POST  — create a new project
 *
 * V1 doesn't have auth yet; we use a fixed demo owner id.
 * Phase 2 will swap to Supabase Auth user id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { listProjects, createProject } from '@/lib/projects';
import { createIntent } from '@/lib/intents';
import { currentUserId } from '@/lib/auth';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export async function GET() {
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    return NextResponse.json({ ok: true, projects });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 }
    );
  }
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['html', 'ppt', 'doc', 'design']),
  // 容纳导入 HTML/PPT 等参考材料 (项目背景里包含拉取的原文 ~8000 字 + 用户描述)
  background: z.string().max(60000).optional(),
  conflictMode: z.enum(['discuss', 'ai_decide']).default('discuss'),
  collaboratorIds: z.array(z.string()).optional(),
  // 导入参考时 (HTML / PPT)，由客户端附带简短的"种子意图"文案，
  // 创建项目后自动以 owner 身份发送一条 Reference 类 Intent 到看板
  seedIntent: z.object({
    statement: z.string().min(1).max(2000),
  }).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Invalid request: ${errorMessage(err)}` },
      { status: 400 }
    );
  }
  try {
    const ownerId = await currentUserId();
    const project = await createProject({
      name: body.name,
      type: body.type,
      background: body.background ?? null,
      conflictMode: body.conflictMode,
      ownerId,
      collaboratorIds: body.collaboratorIds,
    });

    // 导入流程: 自动以 owner 身份在意图看板挂一条 Reference Intent
    // 把"基于 X 复刻"这个意图显性化, 用户进入项目就能看到 (类型/scope/weight 直接给, 跳过 LLM extract)
    if (body.seedIntent?.statement) {
      try {
        await createIntent({
          projectId: project.id,
          authorId: ownerId,
          authorKind: 'human',
          statement: body.seedIntent.statement,
          type: 'Reference',
          scope: 'global',
          weight: 'should',
          rationale: '导入参考创建项目时自动生成的种子意图',
        });
      } catch (err) {
        console.warn('[projects.create] seed intent failed:', err);
      }
    }

    revalidatePath('/');
    revalidatePath('/memory');
    revalidatePath('/employees');
    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 }
    );
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
