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
  // 导入 HTML 时: 把抓取到的原始 HTML 作为"复刻蓝本"传进来,
  // 我们存到 project.background 用 marker 包起来, 合成 prompt 会读取并复刻。
  // 不再直接走 createVersion — 所有版本都由 LLM 生成,保持单一合成入口。
  referenceHtml: z.string().max(500_000).optional(),
  referenceUrl: z.string().max(2000).optional(),
  referenceTitle: z.string().max(500).optional(),
});

const REFERENCE_HTML_BUDGET = 60_000;

/**
 * 把抓到的 rawHtml 压缩到 ~60KB 喂给 LLM:
 * - 删 base64 内嵌 (img/source/url 起头的 data:base64 字符串占大半空间)
 * - 折叠空白
 * - 截断 (开头 40KB + 末尾 20KB),保留 head/title/footer 关键结构
 */
function condenseReferenceHtml(raw: string): string {
  let s = raw;
  s = s.replace(/data:[^"')\s]+;base64,[^"')\s]+/g, 'data:base64:[stripped]');
  s = s.replace(/\s+/g, ' ');
  if (s.length <= REFERENCE_HTML_BUDGET) return s;
  const head = REFERENCE_HTML_BUDGET - 20_000;
  return s.slice(0, head) + '\n<!-- ...(reference html truncated)... -->\n' + s.slice(s.length - 20_000);
}

const REF_MARKER_OPEN = '【导入参考 (HTML)】';
const REF_MARKER_CLOSE = '【/导入参考 (HTML)】';

function buildBackgroundWithReference(
  userBackground: string | null | undefined,
  ref: { url?: string; title?: string; html: string }
): string {
  const condensed = condenseReferenceHtml(ref.html);
  const meta = [
    ref.url ? `来源: ${ref.url}` : '',
    ref.title ? `标题: ${ref.title}` : '',
  ].filter(Boolean).join('\n');
  const refBlock = [
    REF_MARKER_OPEN,
    meta,
    '',
    '原始 HTML (压缩):',
    condensed,
    REF_MARKER_CLOSE,
  ].filter(Boolean).join('\n');
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

    // 导入 HTML 模式: 把 rawHtml 压缩后塞进 background, 用 marker 包起来。
    // 合成 prompt 看到 marker 会按"复刻蓝本"路径处理, AI 自己生成 v1。
    let finalBackground = body.background ?? null;
    if (body.referenceHtml && body.type === 'html') {
      finalBackground = buildBackgroundWithReference(body.background, {
        url: body.referenceUrl,
        title: body.referenceTitle,
        html: body.referenceHtml,
      });
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
