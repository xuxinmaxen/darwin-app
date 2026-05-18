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
import {
  REF_MARKER_OPEN,
  REF_MARKER_CLOSE,
  REF_LAZY_PLACEHOLDER,
  buildReferenceBlock,
} from '@/lib/fetch-imported-html';

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
  // 导入 HTML — 两种调用方式都接受:
  //
  // (a) UI 主流程: 只传 referenceUrl。服务端把 URL 包进 marker 写进 background,
  //     首次合成时 server-side fetch (见 synthesize route 的 hydrateLazyReferenceIfNeeded)。
  //
  // (b) 程序化客户端 (e2e 测试 / 直接 API 调用): 同时传 referenceHtml + referenceUrl
  //     (+ optional referenceTitle), 服务端就直接把这份 HTML 包进 marker, 跳过 lazy-fetch。
  //     这条路径让 e2e 能拿测试用的人造 HTML 喂进来 (acmestudio.com 之类不真存在的 host)。
  referenceUrl: z.string().max(2000).optional(),
  referenceHtml: z.string().max(500_000).optional(),
  referenceTitle: z.string().max(500).optional(),
});

/**
 * 创建项目时只知道 URL, 还没真正抓 HTML。把 URL 包进 marker 写进 background,
 * 合成 route 第一次跑时会从 marker 抽 URL → lazy-fetch → 拼 prompt。
 */
function buildBackgroundWithReferenceUrlOnly(
  userBackground: string | null | undefined,
  url: string
): string {
  const refBlock = [
    REF_MARKER_OPEN,
    `来源: ${url}`,
    REF_LAZY_PLACEHOLDER,
    REF_MARKER_CLOSE,
  ].join('\n');
  const userPart = (userBackground ?? '').trim();
  return userPart ? `${userPart}\n\n${refBlock}` : refBlock;
}

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

    // 导入 HTML 模式: 两种路径
    //   - 程序化传了 referenceHtml: 直接落完整 marker block (含 condensed HTML)
    //   - UI 只传 referenceUrl: 落 lazy placeholder, 首次合成时 server-side fetch
    let finalBackground = body.background ?? null;
    if (body.type === 'html') {
      if (body.referenceHtml) {
        const block = buildReferenceBlock({
          url: body.referenceUrl,
          title: body.referenceTitle,
          html: body.referenceHtml,
        });
        const userPart = (body.background ?? '').trim();
        finalBackground = userPart ? `${userPart}\n\n${block}` : block;
      } else if (body.referenceUrl) {
        finalBackground = buildBackgroundWithReferenceUrlOnly(
          body.background,
          body.referenceUrl
        );
      }
    }

    const project = await createProject({
      name: body.name,
      type: body.type,
      background: finalBackground,
      conflictMode: body.conflictMode,
      ownerId,
      collaboratorIds: body.collaboratorIds,
    });

    // 导入流程: 创建一条 Reference 类的"种子意图"放看板, 让团队看到出发点。
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
