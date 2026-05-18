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

import { NextResponse, after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getLatestVersion, publishVersion } from '@/lib/versions';
import { markPublished, getProject, listCollaborators } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import { listTensions } from '@/lib/tensions';
import { recomputeAgentTags } from '@/lib/agent-tags';

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

    const [intents, tensions, collaborators] = await Promise.all([
      listIntentsByProject(id),
      listTensions(id),
      listCollaborators(id),
    ]);

    // 发布后 fire-and-forget: 所有 Agent 协作者重新计算标签 (学习本项目的决策偏好)
    // 用 after() 而不是 setTimeout, 见 intents/route.ts 注释 (Vercel serverless freeze)。
    const agentCollaborators = collaborators.filter(c => c.kind === 'agent');
    if (agentCollaborators.length > 0) {
      after(async () => {
        await Promise.allSettled(
          agentCollaborators.map(a =>
            recomputeAgentTags(a.id).catch(err =>
              console.warn(`[publish] recomputeAgentTags(${a.id}) failed:`, err)
            )
          )
        );
      });
    }

    revalidatePath(`/projects/${id}`);
    revalidatePath('/');

    const consensusCount = tensions.filter(
      t => t.status === 'resolved' && t.resolution?.selectedOptionKey !== 'stale'
    ).length;

    return NextResponse.json({
      ok: true,
      version: published,
      stats: {
        intents: intents.length,
        intentIds: published.intentIds.length,
        consensusCount,
        contributorCount: collaborators.length,
        // 告诉前端有几个 Agent 在学习,用于显示学习通知
        agentLearningCount: agentCollaborators.length,
        agentNames: agentCollaborators.map(a => a.name),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
