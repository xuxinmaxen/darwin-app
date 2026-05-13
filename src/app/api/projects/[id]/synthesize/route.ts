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
import { synthesize, synthesizeStream, type SynthesisEvent } from '@/lib/synthesize';
import { createVersion, getLatestVersion } from '@/lib/versions';

// Next.js 16: 流式路由必须是动态路由
export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  // SSE 流式模式: 客户端带 Accept: text/event-stream
  const wantsStream = req.headers.get('accept')?.includes('text/event-stream');
  if (wantsStream) {
    return handleStreamPost(id);
  }

  // 非流式(原逻辑保持不变,用于兜底)
  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ ok: false, error: 'project not found' }, { status: 404 });
    }
    const [intents, latestVersion] = await Promise.all([
      listIntentsByProject(id),
      getLatestVersion(id),
    ]);
    if (intents.length === 0) {
      return NextResponse.json({ ok: false, error: '至少需要 1 条 Intent 才能合成' }, { status: 400 });
    }
    const existing = latestVersion
      ? { html: latestVersion.content, intentIds: latestVersion.intentIds }
      : null;
    const result = await synthesize(project, intents, existing);
    const version = await createVersion({
      projectId: id, format: project.type, content: result.content,
      intentIds: intents.map(i => i.id),
    });
    revalidatePath(`/projects/${id}`);
    revalidatePath('/');
    return NextResponse.json(
      { ok: true, version: { ...version, source: result.source }, source: result.source, mode: result.mode, reason: result.reason },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: errMsg(err) }, { status: 500 });
  }
}

/** SSE 流式处理:把 synthesizeStream 的 events 编码成 text/event-stream */
async function handleStreamPost(projectId: string): Promise<Response> {
  const enc = new TextEncoder();

  function sseChunk(event: SynthesisEvent): Uint8Array {
    return enc.encode(`data: ${JSON.stringify(event)}\n\n`);
  }

  const project = await getProject(projectId);
  if (!project) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(sseChunk({ type: 'error', message: 'project not found' }));
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }

  const [intents, latestVersion] = await Promise.all([
    listIntentsByProject(projectId),
    getLatestVersion(projectId),
  ]);

  if (intents.length === 0) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(sseChunk({ type: 'error', message: '至少需要 1 条 Intent 才能合成' }));
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }

  const existing = latestVersion
    ? { html: latestVersion.content, intentIds: latestVersion.intentIds }
    : null;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        let finalHtml = '';
        let finalSource: 'llm' | 'template' = 'template';
        let finalMode: 'full' | 'incremental' = 'full';

        for await (const event of synthesizeStream(project, intents, existing)) {
          controller.enqueue(sseChunk(event));
          if (event.type === 'complete') {
            finalHtml = event.html;
            finalSource = event.source;
            finalMode = event.mode;
          }
        }

        // 保存版本到 DB
        if (finalHtml) {
          const version = await createVersion({
            projectId,
            format: project.type,
            content: finalHtml,
            intentIds: intents.map(i => i.id),
          });
          // 发送已入库的版本元数据给客户端
          controller.enqueue(sseChunk({
            type: 'saved',
            version: { ...version, source: finalSource },
            mode: finalMode,
          }));
          revalidatePath(`/projects/${projectId}`);
          revalidatePath('/');
        }
      } catch (err) {
        controller.enqueue(sseChunk({ type: 'error', message: errMsg(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
