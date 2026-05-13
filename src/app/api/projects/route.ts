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
import { createVersion } from '@/lib/versions';
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
  // 导入 HTML 时: 把抓取到的原始 HTML 作为 v1 直接入库, 不调用 LLM 重生成
  // 后续意图触发增量更新, AI 在此基础上做最小修改
  seedHtml: z.string().max(500_000).optional(),
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

    // 导入流程: 种子意图 + 种子 HTML 都在创建时一起入库
    let seedIntentId: string | null = null;
    if (body.seedIntent?.statement) {
      try {
        const intent = await createIntent({
          projectId: project.id,
          authorId: ownerId,
          authorKind: 'human',
          statement: body.seedIntent.statement,
          type: 'Reference',
          scope: 'global',
          weight: 'should',
          rationale: '导入参考创建项目时自动生成的种子意图',
        });
        seedIntentId = intent.id;
      } catch (err) {
        console.warn('[projects.create] seed intent failed:', err);
      }
    }

    // 关键: 抓取到的原始 HTML 直接作为 v1 入库,不调用 LLM。
    // 用户进入项目即看到原页面 1:1 复刻,后续意图触发 incremental 修改。
    if (body.seedHtml && body.type === 'html') {
      try {
        await createVersion({
          projectId: project.id,
          format: project.type,
          content: body.seedHtml,
          intentIds: seedIntentId ? [seedIntentId] : [],
        });
      } catch (err) {
        console.warn('[projects.create] seed version failed:', err);
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
