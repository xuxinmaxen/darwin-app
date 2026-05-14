/**
 * 服务端合成状态快照 — 跨刷新接力。
 *
 * 合成是 SSE 流式 + Vercel 函数生命周期 ≈ 客户端连接生命周期。
 * 客户端刷新页面 → 旧连接断开 → 函数继续跑到完成 (safeEnqueue 保证) →
 * 但新打开的客户端拿不到中途的 partial HTML, 只能等最终 version 入库。
 *
 * 这个模块把 partial HTML / 阶段 / thinking 文案写到 projects 表,
 * 新客户端 mount 时 GET /api/projects/:id/synthesize/job 就能秒接渲染。
 *
 * 9 列 (在 supabase/migrations/20260514000000_*.sql 应用):
 *   - synthesis_running             BOOLEAN  当前是否有合成进行中
 *   - synthesis_pending_intent_ids  TEXT     启动时捕获的 intent id 列表 (JSON)
 *   - synthesis_partial_html        TEXT     LLM 已经流出的累积 HTML
 *   - synthesis_phase               TEXT     'starting' | 'streaming' | 'saving' | 'done' | 'error'
 *   - synthesis_thinking_msg        TEXT     UI 顶部覆盖层文案
 *   - synthesis_started_at          TIMESTAMPTZ
 *   - synthesis_updated_at          TIMESTAMPTZ  心跳, zombie 检测用
 *   - synthesis_error               TEXT     失败时存原因
 *   - reference_html                TEXT     (留位, 当前还走 background marker)
 */

import { db, assertOk, nowISO } from './db';

export type SynthesisPhase =
  | 'starting'
  | 'streaming'
  | 'saving'
  | 'done'
  | 'error';

export type SynthesisJobSnapshot = {
  running: boolean;
  phase: SynthesisPhase | null;
  thinkingMsg: string | null;
  partialHtml: string | null;
  intentIds: string[];
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
};

/**
 * 超过这个时间没心跳的 running 任务视为 zombie, GET /job 自动收尾.
 * 正常合成每 ~1.5s 心跳, 2 分钟 (80x 心跳间隔) 没心跳就是函数被 Vercel timeout
 * 强杀了 (Vercel 流式函数 maxDuration 上限 300s, 也可能更早被基础设施清理).
 * 不再用 5 min — 那样用户多等 3 分钟才能解锁继续操作.
 */
const ZOMBIE_TIMEOUT_MS = 2 * 60 * 1000;

/** chunk 累积到这个长度就 flush 一次 partial_html, 减少 DB 写次数 */
export const PARTIAL_HTML_FLUSH_INTERVAL_MS = 1500;

/** 启动一个合成: 占用 synthesis_running 标记, 写起始状态 */
export async function startSynthesisJob(
  projectId: string,
  intentIds: string[]
): Promise<void> {
  const now = nowISO();
  assertOk(
    await db()
      .from('projects')
      .update({
        synthesis_running: true,
        synthesis_pending_intent_ids: JSON.stringify(intentIds),
        synthesis_partial_html: null,
        synthesis_phase: 'starting',
        synthesis_thinking_msg: null,
        synthesis_started_at: now,
        synthesis_updated_at: now,
        synthesis_error: null,
      })
      .eq('id', projectId)
  );
}

/** 写当前 thinking 文案 (高频, 短) */
export async function updateThinking(
  projectId: string,
  msg: string,
  phase: SynthesisPhase = 'streaming'
): Promise<void> {
  try {
    await db()
      .from('projects')
      .update({
        synthesis_thinking_msg: msg,
        synthesis_phase: phase,
        synthesis_updated_at: nowISO(),
      })
      .eq('id', projectId);
  } catch {
    // 心跳更新失败不致命, 跑下一轮再补
  }
}

/** 写当前 partial HTML (中频, 大文本) — 调用者要自己做 throttle */
export async function updatePartialHtml(
  projectId: string,
  partialHtml: string
): Promise<void> {
  try {
    await db()
      .from('projects')
      .update({
        synthesis_partial_html: partialHtml,
        synthesis_phase: 'streaming',
        synthesis_updated_at: nowISO(),
      })
      .eq('id', projectId);
  } catch {
    // 同上
  }
}

/** 释放 running 标记 (成功 / 失败 / zombie 都走这里) */
export async function finishSynthesisJob(
  projectId: string,
  outcome: { phase: 'done' | 'error'; error?: string }
): Promise<void> {
  try {
    await db()
      .from('projects')
      .update({
        synthesis_running: false,
        synthesis_phase: outcome.phase,
        synthesis_thinking_msg: null,
        synthesis_partial_html: null,
        synthesis_pending_intent_ids: null,
        synthesis_updated_at: nowISO(),
        synthesis_error: outcome.error ?? null,
      })
      .eq('id', projectId);
  } catch {
    // 即使清理失败也不让上游报错, zombie 检测会兜底
  }
}

type ProjectStateRow = {
  synthesis_running: boolean | null;
  synthesis_pending_intent_ids: string | null;
  synthesis_partial_html: string | null;
  synthesis_phase: string | null;
  synthesis_thinking_msg: string | null;
  synthesis_started_at: string | null;
  synthesis_updated_at: string | null;
  synthesis_error: string | null;
};

/** 拉当前快照 — 用于 GET /job 接口 + zombie 检测 */
export async function getSynthesisJob(
  projectId: string
): Promise<SynthesisJobSnapshot | null> {
  const { data, error } = await db()
    .from('projects')
    .select(
      'synthesis_running, synthesis_pending_intent_ids, synthesis_partial_html, synthesis_phase, synthesis_thinking_msg, synthesis_started_at, synthesis_updated_at, synthesis_error'
    )
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as ProjectStateRow;
  const running = !!row.synthesis_running;

  // Zombie 检测: 标记 running 但 updated_at 太久没动 → 强制收尾, 给客户端正常 fallback
  if (running && row.synthesis_updated_at) {
    const lastBeat = new Date(row.synthesis_updated_at).getTime();
    if (Date.now() - lastBeat > ZOMBIE_TIMEOUT_MS) {
      await finishSynthesisJob(projectId, {
        phase: 'error',
        error: '合成超时无心跳,已强制收尾',
      });
      return {
        running: false,
        phase: 'error',
        thinkingMsg: null,
        partialHtml: null,
        intentIds: [],
        startedAt: row.synthesis_started_at,
        updatedAt: row.synthesis_updated_at,
        error: '合成超时无心跳,已强制收尾',
      };
    }
  }

  let intentIds: string[] = [];
  if (row.synthesis_pending_intent_ids) {
    try {
      const parsed = JSON.parse(row.synthesis_pending_intent_ids);
      if (Array.isArray(parsed)) {
        intentIds = parsed.filter((x: unknown): x is string => typeof x === 'string');
      }
    } catch {
      // 损坏数据当空处理
    }
  }

  return {
    running,
    phase: (row.synthesis_phase as SynthesisPhase | null) ?? null,
    thinkingMsg: row.synthesis_thinking_msg,
    partialHtml: row.synthesis_partial_html,
    intentIds,
    startedAt: row.synthesis_started_at,
    updatedAt: row.synthesis_updated_at,
    error: row.synthesis_error,
  };
}
