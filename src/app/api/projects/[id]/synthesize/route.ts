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
import { getProject, updateProject } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import { synthesize, synthesizeStream, type SynthesisEvent } from '@/lib/synthesize';
import { createVersion, getLatestVersion } from '@/lib/versions';
import {
  startSynthesisJob,
  updateThinking,
  updatePartialHtml,
  finishSynthesisJob,
  PARTIAL_HTML_FLUSH_INTERVAL_MS,
} from '@/lib/synthesis-state';
import type { Project } from '@/lib/types';
import {
  extractLazyReferenceUrl,
  fetchImportedHtml,
  buildReferenceBlock,
  REF_MARKER_OPEN,
  REF_MARKER_CLOSE,
} from '@/lib/fetch-imported-html';

// Next.js 16: 流式路由必须是动态路由
export const dynamic = 'force-dynamic';
// 增量更新 16+ intents 复刻 25KB HTML 时 cc-switch/Hermes 偶尔走到 4-5 分钟.
// Vercel 默认 10s 会 kill 函数; streaming response 没有 maxDuration 会被截.
// 300s = Pro plan 上限, 给足时间避免半截入库.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * 如果 project.background 里塞的是 lazy reference marker (只有 URL, 没 HTML),
 * 这一刻 fetch 原页 + 写回 background, 然后返回 hydrated project。
 *
 * 写回 DB 是为了:
 *   1. 第二次合成不需要再抓 (省 ~10s + 远端 hiccup 风险)
 *   2. 详情页 background 展示能看到 marker 已落地
 * 失败时不抛错: 返回原 project, 合成 prompt 会进入 "URL-only inspiration" 兜底模式。
 */
async function hydrateLazyReferenceIfNeeded(project: Project): Promise<Project> {
  const lazyUrl = extractLazyReferenceUrl(project.background);
  if (!lazyUrl) return project;

  try {
    const fetched = await fetchImportedHtml(lazyUrl);
    const newBlock = buildReferenceBlock({
      url: fetched.url,
      title: fetched.title,
      html: fetched.rawHtml,
    });
    // 替换 background 里整个 marker block, 保留 marker 之外用户写的 text
    const re = new RegExp(
      `${escapeRegex(REF_MARKER_OPEN)}[\\s\\S]*?${escapeRegex(REF_MARKER_CLOSE)}`
    );
    const newBackground = (project.background ?? '').replace(re, newBlock);
    const updated = await updateProject(project.id, { background: newBackground });
    return updated;
  } catch (err) {
    console.warn(`[synthesize] lazy fetch failed for ${lazyUrl}:`, err);
    return project;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    let project = await getProject(id);
    if (!project) {
      return NextResponse.json({ ok: false, error: 'project not found' }, { status: 404 });
    }
    project = await hydrateLazyReferenceIfNeeded(project);
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

  let project = await getProject(projectId);
  if (!project) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(sseChunk({ type: 'error', message: 'project not found' }));
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }
  project = await hydrateLazyReferenceIfNeeded(project);

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

  /** 安全 enqueue — 客户端断开后 controller 可能已关闭,捕获错误让合成继续 */
  function safeEnqueue(controller: ReadableStreamDefaultController<Uint8Array>, event: SynthesisEvent) {
    try { controller.enqueue(sseChunk(event)); } catch { /* client disconnected, continue */ }
  }

  // 占口 — 之后即使客户端断, GET /synthesize/job 也能看到 running 状态
  // 失败不致命: DB 写不了就回退到当前行为 (无跨刷新接力, 不破坏主路径)
  try {
    await startSynthesisJob(projectId, intents.map(i => i.id));
  } catch (err) {
    console.warn('[synthesize] startSynthesisJob failed (degrading to no-resume):', errMsg(err));
  }

  const readable = new ReadableStream({
    async start(controller) {
      let finalHtml = '';
      let finalSource: 'llm' | 'template' | 'patch' = 'template';
      let finalMode: 'full' | 'incremental' = 'full';

      // partial_html 节流: 累积 chunk, 每 PARTIAL_HTML_FLUSH_INTERVAL_MS 写一次 DB
      let partialBuf = '';
      let lastFlushAt = 0;
      let pendingPartialWrite: Promise<void> | null = null;
      const maybeFlushPartial = (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlushAt < PARTIAL_HTML_FLUSH_INTERVAL_MS) return;
        if (!partialBuf) return;
        // fire-and-forget: 上一个还没回来就跳过这次, 下一个 chunk 会再触发
        if (pendingPartialWrite) return;
        lastFlushAt = now;
        const snapshot = partialBuf;
        pendingPartialWrite = updatePartialHtml(projectId, snapshot)
          .finally(() => { pendingPartialWrite = null; });
      };

      try {
        for await (const event of synthesizeStream(project, intents, existing)) {
          safeEnqueue(controller, event);
          if (event.type === 'thinking') {
            updateThinking(projectId, event.message, 'streaming').catch(() => {});
          } else if (event.type === 'chunk') {
            partialBuf += event.content;
            maybeFlushPartial();
          } else if (event.type === 'complete') {
            finalHtml = event.html;
            finalSource = event.source;
            finalMode = event.mode;
            partialBuf = finalHtml;
            maybeFlushPartial(true);
          }
        }
      } catch (err) {
        safeEnqueue(controller, { type: 'error', message: errMsg(err) });
      }

      // 版本入库 — 即使客户端已断开也要完成,让轮询能找到新版本
      if (finalHtml) {
        updateThinking(projectId, '保存版本中…', 'saving').catch(() => {});
        try {
          const version = await createVersion({
            projectId,
            format: project.type,
            content: finalHtml,
            intentIds: intents.map(i => i.id),
          });
          safeEnqueue(controller, {
            type: 'saved',
            version: { ...version, source: finalSource },
            mode: finalMode,
          });
          revalidatePath(`/projects/${projectId}`);
          revalidatePath('/');
          await finishSynthesisJob(projectId, { phase: 'done' });
        } catch (err) {
          safeEnqueue(controller, { type: 'error', message: `保存版本失败: ${errMsg(err)}` });
          await finishSynthesisJob(projectId, { phase: 'error', error: `保存版本失败: ${errMsg(err)}` });
        }
      } else {
        // synthesizeStream 抛错或返回空 — 也要释放占口
        await finishSynthesisJob(projectId, { phase: 'error', error: '合成未产出 HTML' });
      }

      try { controller.close(); } catch { /* already closed */ }
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
