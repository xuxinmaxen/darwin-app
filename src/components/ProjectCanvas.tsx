'use client';

/**
 * 项目画布 — Client Component
 *
 * version 状态由 ProjectShell 控制 (回滚/合成都从父组件下来),
 * 这里只负责: 触发合成、渲染 iframe、注入 provenance/trace 高亮。
 *
 * 状态:
 *   1. 0 条 Intent + 没合成过:    空态插画
 *   2. ≥1 条 Intent + 没合成过:   「开始合成」CTA (用户必须点一次,确认要开始)
 *   3. 有 currentVersion:        iframe 渲染 + 底部状态条
 *
 * 预览:
 *   - previewVersion 不为 null 时,iframe srcDoc 用 previewVersion.content,
 *     当前版本仍然在 currentVersion 里 — 退出预览即恢复
 *   - 预览中不阻塞自动重合成 (合成结果会更新 currentVersion,但 iframe 仍显示
 *     preview。退出预览后会看到新版本)
 */

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import type { Project, Intent } from '@/lib/types';
import type { Version } from '@/lib/versions';
import { TYPE_LABEL } from '@/lib/type-meta';

// 冲突检测异步运行 (fire-and-forget), 有分歧时 activeTensionCount > 0 会阻断合成。
// debounce 给检测足够时间后再触发合成, 通常 LLM 8-12s 内返回。
const AUTO_SYNC_DEBOUNCE_MS = Number(
  typeof window !== 'undefined'
    ? undefined
    : process?.env?.DARWIN_AUTOSYNC_DEBOUNCE_MS
) || 10_000;

/** 在合成产物里注入 <base target="_blank"> 防止 iframe 内链接导航破坏当前页面 */
function injectBaseTarget(html: string): string {
  if (html.includes('<base')) return html;
  return html.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">');
}

const HIGHLIGHT_STYLE = `
  [data-scope] {
    transition: outline-color 0.15s, box-shadow 0.15s;
  }
  [data-scope].darwin-hl {
    outline: 2px solid #4F46E5;
    outline-offset: -2px;
    box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.18);
  }
  [data-scope].darwin-trace {
    outline: 1px dashed rgba(79, 70, 229, 0.45);
    outline-offset: -1px;
    position: relative;
  }
  [data-scope].darwin-trace > .darwin-trace-pill {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 9999;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 5px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid #E8E5DA;
    color: #525560;
    font: 500 10.5px/1 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    letter-spacing: 0;
    box-shadow: 0 1px 2px rgba(20, 20, 30, 0.04), 0 0 0 1px rgba(20, 20, 30, 0.04);
    pointer-events: none;
    user-select: none;
  }
  .darwin-trace-pill .darwin-trace-stack {
    display: inline-flex;
    align-items: center;
  }
  .darwin-trace-pill .darwin-trace-avatar {
    width: 18px; height: 18px;
    border-radius: 50%;
    color: #fff;
    font: 600 9px/1 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1.5px solid #fff;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .darwin-trace-pill .darwin-trace-avatar + .darwin-trace-avatar {
    margin-left: -4px;
  }
  .darwin-trace-pill .darwin-trace-avatar.is-human {
    background: linear-gradient(135deg, #3B82F6, #1D4ED8);
  }
  .darwin-trace-pill .darwin-trace-avatar.is-agent {
    background: linear-gradient(135deg, #8B5CF6, #6D28D9);
  }
  .darwin-trace-pill .darwin-trace-num {
    font-variant-numeric: tabular-nums;
    color: #525560;
  }
`;

function hashIds(ids: string[]): string {
  return ids.slice().sort().join(',') + '|' + ids.length;
}
function hashIntents(intents: Intent[]): string {
  return hashIds(intents.map(i => i.id));
}

export default function ProjectCanvas({
  project,
  intents,
  currentVersion,
  previewVersion,
  claudeReady,
  highlightScopes,
  onSectionHover,
  traceMode,
  onVersionCreated,
  onExitPreview,
  activeTensionCount = 0,
  onSynthesisStart,
}: {
  project: Project;
  intents: Intent[];
  currentVersion: Version | null;
  previewVersion: Version | null;
  claudeReady: boolean;
  highlightScopes?: ReadonlySet<string>;
  onSectionHover?: (scope: string | null) => void;
  traceMode?: boolean;
  onVersionCreated: (v: Version) => void;
  onExitPreview?: () => void;
  activeTensionCount?: number;
  /** 合成开始时立刻通知父组件,让看板提前显示分界线 */
  onSynthesisStart?: () => void;
}) {
  const [isFirstPending, startFirstTransition] = useTransition();
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [lastSyncMode, setLastSyncMode] = useState<'full' | 'incremental' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── 流式合成状态 ──────────────────────────────────────────
  /** 流式过程中 AI 当前的状态说明 */
  const [thinkingMsg, setThinkingMsg] = useState<string>('');
  /** 流式期间实时渲染到 iframe 的 HTML (每 400ms 更新一次) */
  const [streamingHtml, setStreamingHtml] = useState<string>('');
  /** 正在进行流式合成 */
  const [streamActive, setStreamActive] = useState(false);

  // 用 ref 积累 chunk 文本,避免每个 chunk 触发 setState
  const streamBufRef = useRef('');
  // 定时把 ref 里的内容同步到 state (→ iframe 刷新)
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startStreamInterval() {
    if (streamIntervalRef.current) return;
    streamIntervalRef.current = setInterval(() => {
      if (streamBufRef.current) {
        setStreamingHtml(injectBaseTarget(streamBufRef.current));
      }
    }, 400);
  }

  function stopStreamInterval() {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
  }

  // 上一次合成时的 intent 指纹 — 跟 currentVersion 一起更新
  const lastSyncedHashRef = useRef<string | null>(
    currentVersion ? hashIds(currentVersion.intentIds) : null
  );
  useEffect(() => {
    if (currentVersion) {
      lastSyncedHashRef.current = hashIds(currentVersion.intentIds);
    }
  }, [currentVersion]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeReady, setIframeReady] = useState(0);

  // ─── Provenance: iframe 同源 DOM 注入 (无需 allow-scripts) ───
  const handleIframeLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    if (!doc.getElementById('darwin-hl-style')) {
      const style = doc.createElement('style');
      style.id = 'darwin-hl-style';
      style.textContent = HIGHLIGHT_STYLE;
      doc.head.appendChild(style);
    }
    setIframeReady(n => n + 1);
  }, []);

  // 反向: hover iframe 内 section → 通知父组件高亮对应 IntentCard
  useEffect(() => {
    if (!iframeReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !onSectionHover) return;
    const nodes = doc.querySelectorAll<HTMLElement>('[data-scope]');
    const enter = (e: Event) => {
      const scope = (e.currentTarget as HTMLElement).dataset.scope || null;
      onSectionHover(scope);
    };
    const leave = () => onSectionHover(null);
    nodes.forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', leave);
    });
    return () => {
      nodes.forEach(n => {
        n.removeEventListener('mouseenter', enter);
        n.removeEventListener('mouseleave', leave);
      });
    };
  }, [iframeReady, onSectionHover]);

  // 正向: highlightScopes 变化 → 给 iframe 内对应 section 加 .darwin-hl
  useEffect(() => {
    if (!iframeReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const nodes = doc.querySelectorAll<HTMLElement>('[data-scope]');
    nodes.forEach(n => {
      const scope = n.dataset.scope || '';
      const hit =
        !!highlightScopes &&
        (highlightScopes.has(scope) || highlightScopes.has('*'));
      n.classList.toggle('darwin-hl', hit);
    });
  }, [iframeReady, highlightScopes]);

  // 溯源 toggle: traceMode true → 全部 [data-scope] 加 .darwin-trace + 头像 pill
  useEffect(() => {
    if (!iframeReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const nodes = doc.querySelectorAll<HTMLElement>('[data-scope]');

    // 给定 section scope, 找出驱动它的所有 Intent (含 global 兜底)
    const intentsForScope = (scope: string): Intent[] =>
      intents.filter(
        i =>
          i.scope === 'global' ||
          i.scope === scope ||
          i.scope.startsWith(scope + '.')
      );

    const renderAvatar = (kind: 'human' | 'agent'): string => {
      const cls = kind === 'agent' ? 'is-agent' : 'is-human';
      const short = kind === 'agent' ? 'A' : '徐';
      return `<span class="darwin-trace-avatar ${cls}">${short}</span>`;
    };

    nodes.forEach(n => {
      const scope = n.dataset.scope || '';
      let pill = n.querySelector<HTMLElement>(':scope > .darwin-trace-pill');
      if (!traceMode) {
        n.classList.remove('darwin-trace');
        if (pill) pill.remove();
        return;
      }

      const matched = intentsForScope(scope);
      const total = matched.length;
      // unique authorKind, 保持稳定顺序: human 在前
      const kinds: ('human' | 'agent')[] = [];
      for (const i of matched) {
        if (!kinds.includes(i.authorKind)) kinds.push(i.authorKind);
      }
      kinds.sort((a) => (a === 'human' ? -1 : 1));

      n.classList.add('darwin-trace');
      const inner = total > 0
        ? `<span class="darwin-trace-stack">${kinds.map(renderAvatar).join('')}</span><span class="darwin-trace-num">${total} 条 Intent</span>`
        : '<span class="darwin-trace-num">未命中</span>';

      if (!pill) {
        pill = doc.createElement('div');
        pill.className = 'darwin-trace-pill';
        n.appendChild(pill);
      }
      pill.innerHTML = inner;
    });

    return () => {
      const cleanupDoc = iframeRef.current?.contentDocument;
      if (!cleanupDoc) return;
      cleanupDoc
        .querySelectorAll<HTMLElement>('[data-scope] > .darwin-trace-pill')
        .forEach(p => p.remove());
      cleanupDoc
        .querySelectorAll<HTMLElement>('[data-scope].darwin-trace')
        .forEach(n => n.classList.remove('darwin-trace'));
    };
  }, [iframeReady, traceMode, intents]);

  // ─── 自动重合成 ──────────────────────────────────────────
  useEffect(() => {
    if (!currentVersion) return;
    if (intents.length === 0) return;
    if (autoSyncing) return;
    // 有未解决冲突时不合成 — 等待分歧解决后再触发
    if (activeTensionCount > 0) return;

    const currentHash = hashIntents(intents);
    if (currentHash === lastSyncedHashRef.current) return;

    const timer = setTimeout(() => {
      runSynthesis(currentHash);
    }, AUTO_SYNC_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intents, currentVersion, project.id, autoSyncing]);

  /** 流式合成核心 — SSE 消费者 */
  async function runSynthesisStream(intentHash: string, isFirstSynth = false) {
    setError(null);
    setThinkingMsg('连接 AI…');
    setStreamActive(true);
    streamBufRef.current = '';
    startStreamInterval();
    onSynthesisStart?.();

    try {
      const res = await fetch(`/api/projects/${project.id}/synthesize`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `请求失败 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        // 解析 SSE 行: 每条事件以 \n\n 结尾
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';

        for (const block of lines) {
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const evt = JSON.parse(dataLine.slice(6));
            if (evt.type === 'thinking') {
              setThinkingMsg(evt.message);
            } else if (evt.type === 'chunk') {
              streamBufRef.current += evt.content;
            } else if (evt.type === 'complete') {
              // LLM 输出结束,立刻刷新一次 iframe 显示最终内容
              streamBufRef.current = evt.html;
              setStreamingHtml(injectBaseTarget(evt.html));
              setThinkingMsg('保存版本中…');
            } else if (evt.type === 'saved') {
              // 版本入库完成
              stopStreamInterval();
              lastSyncedHashRef.current = intentHash;
              setLastSyncMode((evt.mode as 'full' | 'incremental') ?? 'full');
              onVersionCreated(evt.version as Version);
              setThinkingMsg('');
              setStreamActive(false);
              setStreamingHtml('');
              streamBufRef.current = '';
            } else if (evt.type === 'error') {
              throw new Error(evt.message);
            }
          } catch {
            // 单条 SSE 解析失败不致命,跳过
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      stopStreamInterval();
      setAutoSyncing(false);
      if (streamActive) {
        setStreamActive(false);
        setThinkingMsg('');
        setStreamingHtml('');
        streamBufRef.current = '';
      }
    }
  }

  async function runSynthesis(intentHash: string) {
    setAutoSyncing(true);
    await runSynthesisStream(intentHash);
  }

  function handleFirstSynthesize() {
    setError(null);
    startFirstTransition(async () => {
      await runSynthesisStream(hashIntents(intents), true);
    });
  }

  // ─── State 1: 没有 Intent ────────────────────────────────
  if (intents.length === 0 && !currentVersion) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty-illu">
          <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M11 3v16M3 11h16M5.5 5.5l11 11M16.5 5.5l-11 11" />
          </svg>
        </div>
        <div>
          <strong>等待 Intent 输入</strong>
          <p>
            大家各自表达想要什么，AI 会抽取为结构化 Intent，再合成为产物。冲突浮现时不阻塞他人贡献。
          </p>
        </div>
      </div>
    );
  }

  // ─── State 2: 有 Intent,首次没合成 ───────────────────────
  if (!currentVersion) {
    return (
      <div className="canvas-cta">
        <div className="canvas-cta-illu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M5 5l4 4M9 5l-4 4M14 5h6M14 9h4M14 13h6M5 17l3 3 8-8" />
          </svg>
        </div>
        <h3 className="canvas-cta-title">
          已收集 {intents.length} 条 Intent · 准备合成 {TYPE_LABEL[project.type]}
        </h3>
        <p className="canvas-cta-sub">
          点下方按钮开始合成。之后每次新增/删除 Intent，AI 会自动重新合成，无需再点。
          {!claudeReady && '（当前 LLM 未连，走本地模板合成）'}
        </p>

        <button
          type="button"
          className="canvas-cta-btn"
          onClick={handleFirstSynthesize}
          disabled={isFirstPending}
        >
          {isFirstPending ? (
            <>
              <span className="canvas-cta-spinner" />
              合成中…
            </>
          ) : (
            <>
              <svg viewBox="0 0 14 14" fill="currentColor">
                <path d="M3.5 2v10l7.5-5z" />
              </svg>
              开始合成
            </>
          )}
        </button>

        {error && <div className="canvas-cta-error">{error}</div>}

        {project.background && (
          <div className="canvas-cta-meta">
            <strong>项目背景</strong>
            <p>{project.background}</p>
          </div>
        )}
      </div>
    );
  }

  // ─── State 3: 有版本 ──────────────────────────────────────
  const isStale =
    intents.length > 0 &&
    hashIntents(intents) !== lastSyncedHashRef.current &&
    !autoSyncing;

  // 实际渲染的 version: 预览中走 preview,否则走当前
  const displayVersion = previewVersion ?? currentVersion;
  // 流式合成期间优先显示实时 HTML;否则显示已保存版本
  const displayContent = (streamActive && streamingHtml) ? streamingHtml : displayVersion.content;
  const displaySource = displayVersion.source;
  const isPreviewing = previewVersion !== null;

  return (
    <div className="canvas-result" style={{ position: 'relative' }}>
      {/* AI Thinking 覆盖层 — 流式合成期间显示 */}
      {streamActive && (
        <div className="canvas-thinking-overlay">
          <span className="canvas-thinking-pulse" />
          <span className="canvas-thinking-msg">{thinkingMsg || 'AI 正在合成…'}</span>
          {/* 进度扫光条 */}
          <span className="canvas-thinking-bar" />
        </div>
      )}

      {isPreviewing && (
        <div className="canvas-preview-banner">
          <span className="ver-preview-badge">预览</span>
          <span>正在预览旧版本,主版本未受影响</span>
          {onExitPreview && (
            <button
              type="button"
              className="canvas-preview-exit"
              onClick={onExitPreview}
            >
              退出预览
            </button>
          )}
        </div>
      )}

      {project.type === 'html' ? (
        <iframe
          key={streamActive ? 'streaming' : displayVersion.id}
          ref={iframeRef}
          onLoad={handleIframeLoad}
          className={`canvas-frame${streamActive ? ' canvas-frame-streaming' : ''}`}
          srcDoc={displayContent.startsWith('<!') || displayContent.startsWith('<html') ? displayContent : injectBaseTarget(displayContent)}
          title={`${project.name} · synthesized preview`}
          sandbox="allow-same-origin"
        />
      ) : (
        <pre className="canvas-md">{streamActive ? streamBufRef.current || displayContent : displayContent}</pre>
      )}

      <div className="canvas-result-foot">
        <div className="canvas-result-meta">
          {autoSyncing ? (
            <span className="canvas-syncing">
              <span className="canvas-syncing-pulse" />
              {lastSyncMode === 'incremental'
                ? 'AI 正在按新 Intent 增量更新…'
                : 'AI 正在合成新版本…'}
            </span>
          ) : isStale && activeTensionCount > 0 ? (
            <span className="canvas-stale canvas-stale-blocked">
              <span className="canvas-stale-dot" />
              有 {activeTensionCount} 个分歧待解决，解决后自动合成新版本</span>
          ) : isStale ? (
            <span className="canvas-stale">
              <span className="canvas-stale-dot" />
              检测到意图变化，正在等待冲突检测完成后合成…
            </span>
          ) : error ? (
            <span className="canvas-sync-error">
              <span>⚠️ 上次自动合成失败</span>
              <button
                type="button"
                className="canvas-retry-btn"
                onClick={() => runSynthesis(hashIntents(intents))}
              >
                重试
              </button>
            </span>
          ) : (
            <>
              <span
                className={`canvas-source-pill canvas-source-${displaySource || 'template'}`}
                title={
                  displaySource === 'llm'
                    ? 'LLM 直出'
                    : '本地模板（LLM 不可用时回退）'
                }
              >
                {displaySource === 'llm' ? '🤖 LLM' : '⚙️ 模板'}
              </span>
              <span>{isPreviewing ? '预览历史版本' : '已同步'}</span>
              <span>·</span>
              <span>{intents.length} 条 Intent</span>
              <span>·</span>
              <span>
                {new Date(displayVersion.createdAt).toLocaleString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </>
          )}
        </div>

        {intents.length === 0 && !isPreviewing && (
          <span className="canvas-no-intents">所有 Intent 已删,保留最后一版</span>
        )}
      </div>

      {error && !autoSyncing && (
        <div className="canvas-result-error">
          {error.length > 200 ? error.slice(0, 200) + '…' : error}
        </div>
      )}
    </div>
  );
}
