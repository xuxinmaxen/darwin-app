/**
 * /api/projects/[id]/synthesize
 *
 * GET   — 返回最近一版合成结果 (no-op 时为 null)
 * POST  — 触发合成: 读 project + intents → synthesize() → 落 versions 表 → 返回新版本
 *
 * V1: 走本地模板合成,不消耗 Claude 额度。
 *     synthesize() 内部留好 Hermes 解锁后切 Claude 的钩子。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getProject } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import { synthesize } from '@/lib/synthesize';
import { createVersion, getLatestVersion } from '@/lib/versions';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const version = await getLatestVersion(id);
    return NextResponse.json({ ok: true, version });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errMsg(err) },
      { status: 500 }
    );
  }
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json(
        { ok: false, error: 'project not found' },
        { status: 404 }
      );
    }
    const intents = await listIntentsByProject(id);
    if (intents.length === 0) {
      return NextResponse.json(
        { ok: false, error: '至少需要 1 条 Intent 才能合成' },
        { status: 400 }
      );
    }

    const result = await synthesize(project, intents);
    const version = await createVersion({
      projectId: id,
      format: project.type,
      content: result.content,
      intentIds: intents.map(i => i.id),
    });

    revalidatePath(`/projects/${id}`);
    revalidatePath('/');

    return NextResponse.json(
      {
        ok: true,
        version: { ...version, source: result.source },
        source: result.source,
        reason: result.reason,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errMsg(err) },
      { status: 500 }
    );
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
