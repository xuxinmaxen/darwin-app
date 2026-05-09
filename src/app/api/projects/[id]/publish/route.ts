/**
 * POST /api/projects/[id]/publish
 *
 * Body: { versionId?: string }
 *   - 不传 versionId → 发布最新一版 (latest by createdAt)
 *   - 传 versionId  → 发布指定版本
 *
 * 副作用:
 *   - 把目标 version.published_at = now (同项目其它 version 的 published_at 清空)
 *   - 把 project.status = 'published'
 *
 * V1 不实际部署 — 这里只是"定稿"语义。真实部署是 V2+ 的 Adapter 层负责。
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getLatestVersion, publishVersion } from '@/lib/versions';
import { markPublished, getProject } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';

const Body = z.object({ versionId: z.string().optional() });

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;

  let parsed: z.infer<typeof Body> = {};
  try {
    const json = await req.json().catch(() => ({}));
    parsed = Body.parse(json);
  } catch {
    parsed = {};
  }

  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json(
        { ok: false, error: 'project not found' },
        { status: 404 }
      );
    }

    let targetVersionId = parsed.versionId;
    if (!targetVersionId) {
      const latest = await getLatestVersion(id);
      if (!latest) {
        return NextResponse.json(
          { ok: false, error: '还没有合成版本,无法发布' },
          { status: 400 }
        );
      }
      targetVersionId = latest.id;
    }

    const published = await publishVersion(id, targetVersionId);
    await markPublished(id);

    const intentCount = (await listIntentsByProject(id)).length;

    revalidatePath(`/projects/${id}`);
    revalidatePath('/');

    return NextResponse.json({
      ok: true,
      version: published,
      stats: {
        intents: intentCount,
        intentIds: published.intentIds.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
