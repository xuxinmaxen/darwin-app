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
import { extractSourceUrl } from '@/lib/extract-source-url';

/** iframe 内 darwin-mark runtime 暴露给父页的 API (见 public/darwin-mark.js 末尾) */
export type DarwinMarkAnnotation = {
  id: number;
  label: string;
  selector: string;
  text: string;
  /** ancestor selector chain; e.g. "body > #view-pending > .state-hero > button" */
  parentPath?: string;
  /** 最近 heading 文本; ≤60 字 */
  nearestHeading?: string;
  /** 最近有标识的容器; aria-label / data-mm-label / data-scope / tabpanel */
  containerLabel?: string;
  /** 元素所在 section id 或 data-scope */
  pageSection?: string;
  note: string;
};
export type DarwinMarkAPI = {
  on: () => void;
  off: () => void;
  isOn: () => boolean;
  list: () => DarwinMarkAnnotation[];
  clear: () => void;
};

// 冲突检测异步运行 (fire-and-forget), 有分歧时 activeTensionCount > 0 会阻断合成。
// agent 反应也通过 agentsReacting 阻断, 反应结束后立刻放开。
// 反应已经在 IntentForm 内 Promise.allSettled, debounce 只需短一些兜底防抖动。
const AUTO_SYNC_DEBOUNCE_MS = Number(
  typeof window !== 'undefined'
    ? undefined
    : process?.env?.DARWIN_AUTOSYNC_DEBOUNCE_MS
) || 2_500;

function sourceMeta(source?: Version['source']) {
  if (source === 'llm') return { cls: 'llm', label: 'LLM', title: 'LLM 完整合成' };
  if (source === 'patch') return { cls: 'patch', label: '局部修补', title: '只修改命中的局部区域,其余保持原样' };
  if (source === 'template') return { cls: 'template', label: '模板', title: '本地模板（LLM 不可用时回退）' };
  return { cls: 'saved', label: '已保存版本', title: '历史保存版本' };
}

const IFRAME_COMPAT_SCRIPT = `
(function(){
  try {
    var NativeMutationObserver = window.MutationObserver;
    if (!NativeMutationObserver || NativeMutationObserver.__darwinObserveGuard) return;
    var nativeObserve = NativeMutationObserver.prototype.observe;
    NativeMutationObserver.prototype.observe = function(target, options) {
      if (!target || typeof target.nodeType !== 'number') return;
      return nativeObserve.call(this, target, options);
    };
    NativeMutationObserver.__darwinObserveGuard = true;
  } catch (e) {}
})();
`;

/**
 * 让 iframe 内的合成 HTML 表现得像一个真实的、自洽的单页网站:
 *
 *   - 导航 link 在 iframe 内部跳转/滚动 (不跑去 darwin.org.cn, 不开新窗口)
 *   - 相对路径 <a href="/about"> → 转成 <a href="#about"> 让浏览器在本页找锚点
 *   - <a href="/"> (logo 回首页) → 转成 <a href="#top"> + body 头部加 id=top 锚点
 *   - hash anchor <a href="#features"> 保留, 浏览器原生滚动
 *   - 真正外部 URL <a href="https://other.com"> 保留, 加 target=_blank rel=noopener
 *   - <img src> 等资源相对路径: 保留 <base href=sourceUrl> 让相对资源还原到原站
 *
 * 这样用户点 nav button 行为符合直觉: 滚到对应 section, 或不跳 (在本页).
 */
function prepareIframeHtml(
  html: string,
  sourceUrl?: string | null,
  markScript?: string | null
): string {
  let s = html;

  // 抽源站 host — 用于把 "指向原站自己" 的绝对/相对链接也压成 hash anchor.
  // 规则: 复刻出来的 HTML 必须自洽, 任何 <a> 都不应该把用户带回原 HTML.
  let sourceHost: string | null = null;
  if (sourceUrl) {
    try { sourceHost = new URL(sourceUrl).host.toLowerCase(); } catch { /* ignore */ }
  }
  // 把任意路径压成 #anchor: /how-it-works → #how-it-works, /a/b → #a-b, about.html → #about
  const pathToAnchor = (path: string): string => {
    let cleaned = path.split(/[?#]/)[0].replace(/^\/+/, '').replace(/\/+$/, '');
    if (!cleaned) return '#top';
    cleaned = cleaned.replace(/\.(html?|php|aspx?|jsp)$/i, '');
    if (!cleaned) return '#top';
    return '#' + cleaned.replace(/\//g, '-');
  };

  // (1) 注入 <base href=sourceUrl> (没有 target!) — 让 <img/link/style> 的相对路径
  //     还原到原站. target 不设 → 默认 _self → 链接在 iframe 内导航.
  const baseTag = sourceUrl ? `<base href="${escapeAttr(sourceUrl)}">` : '';
  if (baseTag) {
    if (/<base\b[^>]*>/i.test(s)) {
      s = s.replace(/<base\b[^>]*>/i, baseTag);
    } else if (/<head\b[^>]*>/i.test(s)) {
      s = s.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    } else {
      s = `<head>${baseTag}</head>` + s;
    }
  } else if (/<base\b[^>]*>/i.test(s)) {
    // 没源 URL 但 LLM 自己输出了 <base> → 去掉, 避免它带歪 target
    s = s.replace(/<base\b[^>]*>/i, '');
  }

  // (1b) 生成/导入 HTML 的脚本质量不可控; 局部修补后常见空节点 observe 导致整页 JS 中断。
  //      只兜住 MutationObserver.observe(non-Node) 这一类脆弱点,其他错误仍正常暴露。
  const compatTag = `<script data-darwin-iframe-compat>${IFRAME_COMPAT_SCRIPT}</script>`;
  if (!/data-darwin-iframe-compat/i.test(s)) {
    if (/<head\b[^>]*>/i.test(s)) {
      s = s.replace(/<head([^>]*)>/i, `<head$1>${compatTag}`);
    } else {
      s = `${compatTag}${s}`;
    }
  }

  // (2) 在 body 顶部注入 <a id="top"> 锚点 → 让 logo (#top) 滚到顶
  if (/<body\b[^>]*>/i.test(s) && !/<a\b[^>]*id\s*=\s*["']top["']/i.test(s)) {
    s = s.replace(/(<body\b[^>]*>)/i, '$1<a id="top" aria-hidden="true"></a>');
  }

  // (3) 改写所有 <a href> — 任何指向原站自己的链接都压成 hash anchor; 真外站才开新窗口.
  s = s.replace(/<a\b([^>]*?)\shref\s*=\s*("|')([^"']*)\2([^>]*)>/gi, (full, before, q, href, after) => {
    const cleanedHref = (href || '').trim();
    const original = full;
    const stripTarget = (s: string) => s.replace(/\s+target\s*=\s*["'][^"']*["']/gi, '');
    const stripRel = (s: string) => s.replace(/\s+rel\s*=\s*["'][^"']*["']/gi, '');
    const beforeC = stripRel(stripTarget(before));
    const afterC = stripRel(stripTarget(after));

    if (!cleanedHref || cleanedHref === '#') return original;
    if (cleanedHref.startsWith('#')) return original;
    if (/^javascript:/i.test(cleanedHref)) return `<a${beforeC} href="#"${afterC}>`;
    if (/^(mailto:|tel:|sms:)/i.test(cleanedHref)) {
      return `<a${beforeC} href="${cleanedHref}"${afterC}>`;
    }
    if (/^\/\//.test(cleanedHref)) {
      // 协议无关 //host/path — 当外部链接处理
      try {
        const u = new URL('https:' + cleanedHref);
        if (sourceHost && u.host.toLowerCase() === sourceHost) {
          return `<a${beforeC} href="${pathToAnchor(u.pathname)}"${afterC}>`;
        }
        return `<a${beforeC} href="https:${cleanedHref}" target="_blank" rel="noopener noreferrer"${afterC}>`;
      } catch {
        return `<a${beforeC} href="#"${afterC}>`;
      }
    }
    if (/^https?:\/\//i.test(cleanedHref)) {
      try {
        const u = new URL(cleanedHref);
        if (sourceHost && u.host.toLowerCase() === sourceHost) {
          // 指向原站自己 — 压成 hash anchor, 不要让用户跳回原页面
          return `<a${beforeC} href="${pathToAnchor(u.pathname)}"${afterC}>`;
        }
        // 真外站 — 新窗口
        return `<a${beforeC} href="${cleanedHref}" target="_blank" rel="noopener noreferrer"${afterC}>`;
      } catch {
        return `<a${beforeC} href="#"${afterC}>`;
      }
    }
    // 站内根路径 / 站内相对路径都压成 hash anchor (默认 <base> 会把它们解析回原站)
    if (cleanedHref === '/') return `<a${beforeC} href="#top"${afterC}>`;
    if (cleanedHref.startsWith('/')) return `<a${beforeC} href="${pathToAnchor(cleanedHref)}"${afterC}>`;
    return `<a${beforeC} href="${pathToAnchor(cleanedHref)}"${afterC}>`;
  });

  // (4) <form action="/login"> 之类的提交也会让 iframe 跳走 — 改成 # 防止 404
  s = s.replace(/<form\b([^>]*?)\saction\s*=\s*("|')([^"']*)\2([^>]*)>/gi, (full, before, q, action, after) => {
    const a = (action || '').trim();
    if (!a || a === '#' || a.startsWith('#')) return full;
    if (/^(mailto:|tel:)/i.test(a)) return full;
    // 任何指向网络的 action 都改成 #, 避免离开 iframe
    return `<form${before} action="#"${after}>`;
  });

  // (5) 注入 darwin-mark 标注 runtime (始终 OFF 状态, 父页通过 window.__darwinMark 控制)
  // 内联进 iframe 而不是 <script src>: srcDoc + <base href> 时相对路径会被解析回原站 404,
  // 绝对 URL 又要 hardcode host;inline 一次 31KB 但免去这些 fragility。
  if (markScript) {
    const tag = `<script>${markScript}</script>`;
    if (/<\/body>/i.test(s)) {
      s = s.replace(/<\/body>/i, `${tag}</body>`);
    } else if (/<\/html>/i.test(s)) {
      s = s.replace(/<\/html>/i, `${tag}</html>`);
    } else {
      s += tag;
    }
  }

  return s;
}

/** 旧名字兼容: 调用方还在用 injectBaseTarget — 转发到新的 prepareIframeHtml */
function injectBaseTarget(
  html: string,
  sourceUrl?: string | null,
  markScript?: string | null
): string {
  return prepareIframeHtml(html, sourceUrl, markScript);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// extractSourceUrl 已抽到 src/lib/extract-source-url.ts (导出 route 也用), 这里 re-import
// 保持原行号附近的代码不破坏其他注释指针。

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
  agentsReacting = false,
  isSynthesizing = false,
  onSynthesisStart,
  resumePartialHtml = null,
  resumeThinkingMsg = null,
  recentSynthFailureAt = null,
  synthFailureMsg = null,
  onRetrySynth,
  markMode = false,
  onMarkBridge,
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
  /** Agent 反应进行中 → 阻断自动合成,等 agent 意图全部进入客户端后再开始 */
  agentsReacting?: boolean;
  /** 父组件维护的合成中状态,跨页面刷新可恢复 (基于 DB) */
  isSynthesizing?: boolean;
  /** 合成开始时立刻通知父组件,让看板提前显示分界线 */
  onSynthesisStart?: () => void;
  /** 跨刷新接力: 服务端最新的 partial HTML (来自 /job 轮询) */
  resumePartialHtml?: string | null;
  /** 跨刷新接力: 服务端最新的 thinking 文案 */
  resumeThinkingMsg?: string | null;
  /** 最近一次合成失败时间戳 — 阻断自动重试死循环 (在 10 min 窗口内) */
  recentSynthFailureAt?: number | null;
  /** 失败原因, 用于 UI 横幅 */
  synthFailureMsg?: string | null;
  /** 用户点 "重新合成" → 父组件清状态 */
  onRetrySynth?: () => void;
  /** 标注模式开关 — true 时调 iframe.contentWindow.__darwinMark.on() */
  markMode?: boolean;
  /** iframe onLoad 后把 __darwinMark API 回吐给父组件, 用于提交意图时读取 pins */
  onMarkBridge?: (api: DarwinMarkAPI | null) => void;
}) {
  const [isFirstPending, startFirstTransition] = useTransition();
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [lastSyncMode, setLastSyncMode] = useState<'full' | 'incremental' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 导入项目时,iframe 内 <a href="/"> 需要还原到原站, 否则相对路径会指向 darwin.org.cn 父页
  const sourceUrl = extractSourceUrl(project.background);

  // ─── 标注 runtime 加载 ──────────────────────────────────────
  // 把 /darwin-mark.js 内容缓存进 state, prepareIframeHtml 每次喂 iframe 时一起 inline。
  // 始终注入 (默认 OFF), 通过 contentWindow.__darwinMark.on() 切换, 避免 toggle 时
  // iframe 重渲染丢 pin。
  const [markScript, setMarkScript] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/darwin-mark.js').then(r => r.text()).then(txt => {
      if (!cancelled) setMarkScript(txt);
    }).catch(() => {/* 网络抖 OK, 标注功能不可用但主流程不受影响 */});
    return () => { cancelled = true; };
  }, []);

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
        setStreamingHtml(injectBaseTarget(streamBufRef.current, sourceUrl, markScript));
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
    // 把 darwin-mark API 引用回吐给父组件 — 提交意图时用来读 pins。
    // 时机: iframe onLoad → script 同步 init 完成 → window.__darwinMark 已存在。
    const win = iframeRef.current?.contentWindow as
      | (Window & { __darwinMark?: DarwinMarkAPI })
      | null
      | undefined;
    if (onMarkBridge) {
      onMarkBridge(win?.__darwinMark ?? null);
    }
    setIframeReady(n => n + 1);
  }, [onMarkBridge]);

  // 父组件 markMode 翻 true/false → 通过桥调 iframe runtime
  useEffect(() => {
    const win = iframeRef.current?.contentWindow as
      | (Window & { __darwinMark?: DarwinMarkAPI })
      | null
      | undefined;
    if (!win?.__darwinMark) return;
    if (markMode && !win.__darwinMark.isOn()) win.__darwinMark.on();
    else if (!markMode && win.__darwinMark.isOn()) win.__darwinMark.off();
  }, [markMode, iframeReady]);

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
  // 失败后冷却窗口: 防止 "失败 → 自动重试 → 又超时失败" 死循环.
  const SYNTH_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

  useEffect(() => {
    if (!currentVersion) return;
    if (intents.length === 0) return;
    if (autoSyncing) return;
    // 父组件维护的"合成中"标志 (跨刷新通过 localStorage 持久化) — 服务端可能还在跑,
    // 这里再起一次会重复消耗 LLM token + 让用户看到产物在两条流之间跳变。
    if (isSynthesizing) return;
    // 有未解决冲突时不合成 — 等待分歧解决后再触发
    if (activeTensionCount > 0) return;
    // Agent 反应进行中 — 等待 agent 意图全部落入客户端再合成,确保分界线位置正确
    if (agentsReacting) return;
    // 最近合成失败过 → 不自动重试; 用户点 "重新合成" 显式触发
    if (recentSynthFailureAt && Date.now() - recentSynthFailureAt < SYNTH_FAILURE_COOLDOWN_MS) return;

    const currentHash = hashIntents(intents);
    if (currentHash === lastSyncedHashRef.current) return;

    const timer = setTimeout(() => {
      runSynthesis(currentHash);
    }, AUTO_SYNC_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intents, currentVersion, project.id, autoSyncing, agentsReacting, isSynthesizing, recentSynthFailureAt]);

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
              setStreamingHtml(injectBaseTarget(evt.html, sourceUrl, markScript));
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
    // 立即通知父组件 → 看板分界线、isSynthesizing 状态、localStorage 同步生效
    // 不等 runSynthesisStream 的 async 入口
    onSynthesisStart?.();
    await runSynthesisStream(intentHash);
  }

  function handleFirstSynthesize() {
    setError(null);
    // 同步触发 → 看板"v1 合成中"分界线立即可见,canvas 切换到合成视图
    onSynthesisStart?.();
    startFirstTransition(async () => {
      await runSynthesisStream(hashIntents(intents), true);
    });
  }

  // 任何合成活动 (新点开始 / SSE 流式 / 跨刷新恢复的 isSynthesizing)
  const isAnySynthActive = isFirstPending || streamActive || isSynthesizing;

  // ─── State 1: 没有 Intent,且没有合成在跑 ────────────────────
  if (intents.length === 0 && !currentVersion && !isAnySynthActive) {
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

  // ─── State 2: 有 Intent,首次没合成,且当前没在合成 ───────────
  if (!currentVersion && !isAnySynthActive) {
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

        {project.background && (() => {
          // 导入参考的项目 background 含 ~8000 字原文,直接倾倒太干扰。
          // 检测到 import marker 时只显示一段简短提示;否则照常展示用户写的背景。
          const bg = project.background;
          const hasImportMarker = bg.includes('【导入参考');
          if (hasImportMarker) {
            const sourceMatch = bg.match(/来源:\s*(\S+)/);
            const titleMatch = bg.match(/标题:\s*([^\n]+)/);
            return (
              <div className="canvas-cta-meta">
                <strong>已导入参考材料</strong>
                <p>
                  {titleMatch ? `「${titleMatch[1].trim()}」` : sourceMatch ? sourceMatch[1] : '导入页面'}
                  {' '}— AI 合成 v1 时会以此为蓝本复刻，再叠加意图调整。
                </p>
              </div>
            );
          }
          return (
            <div className="canvas-cta-meta">
              <strong>项目背景</strong>
              <p>{bg}</p>
            </div>
          );
        })()}
      </div>
    );
  }

  // ─── State 3: 有版本 OR 合成中 ──────────────────────────────────────
  const isStale =
    intents.length > 0 &&
    hashIntents(intents) !== lastSyncedHashRef.current &&
    !autoSyncing;

  // 实际渲染的 version: 预览中走 preview,否则走当前 (首次合成时可能为 null)
  const displayVersion = previewVersion ?? currentVersion;
  const isPreviewing = previewVersion !== null;
  // 占位 HTML:首次合成、刷新恢复 (无 currentVersion 时) 提供一个空 iframe 让 overlay 覆盖
  const PLACEHOLDER_HTML = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#FAF9F5;}</style></head><body></body></html>';

  // resumed: 刷新后服务端还在跑, ProjectShell 拉 /job 喂下来 partialHtml
  //
  // 注意: 这里不再要求 !displayVersion. 之前的逻辑是 "只有完全没版本时才进 resume",
  // 但实际场景是 v2 已存在 → 正在合成 v3 时刷新 → displayVersion=v2 不为 null
  // → isResumedPhase=false → 错误地走到 isStale 分支显示 "AI 正在检测意图冲突".
  // 修正: isSynthesizing=true 就是 resume, 不论是否有旧版本.
  const isResumedPhase = isSynthesizing && !streamActive && !isFirstPending;

  // 流式合成期间优先显示实时 HTML;否则 (resumed 阶段) 显示服务端 partial;
  // 否则显示已保存版本;都没有就放占位
  // 所有 HTML 在喂 iframe 前都过 injectBaseTarget — 注入 <base href + target="_blank">,
  // 让导入项目的 <a href="/"> 在新窗口打开原站, 不再被解析成 darwin.org.cn 父页。
  const rawDisplayContent = (streamActive && streamingHtml)
    ? streamingHtml  // 已经 injectBaseTarget 过
    : (isResumedPhase && resumePartialHtml)
      ? injectBaseTarget(resumePartialHtml, sourceUrl, markScript)
      : (displayVersion?.content ?? PLACEHOLDER_HTML);
  const displayContent = streamingHtml === rawDisplayContent
    ? rawDisplayContent  // streamingHtml 路径已注入, 不重复
    : injectBaseTarget(rawDisplayContent, sourceUrl, markScript);
  const displaySource = displayVersion?.source;
  const displaySourceMeta = sourceMeta(displaySource);

  // ─── Thinking overlay 阶段判断 ──────────────────────────
  // 阶段 1 (detect): 有新意图未合成 → 正在检测冲突中 (等待 10s debounce + 5s poll)
  // 阶段 2 (conflict): 检测到冲突,等待解决
  // 阶段 3 (synth): 冲突已解决 / 无冲突,正在流式合成
  // 阶段 3b (resumed): 刷新后恢复的合成中状态 (有服务端 partial, 走轮询)
  const isSynthPhase = streamActive || isFirstPending;
  // 在失败冷却期 → detect/conflict overlay 都不显示 (auto-sync 已 gate, 显示出来误导)
  const inFailureCooldown =
    !!recentSynthFailureAt &&
    Date.now() - recentSynthFailureAt < SYNTH_FAILURE_COOLDOWN_MS;
  const isConflictPhase = isStale && activeTensionCount > 0 && !isSynthPhase && !isResumedPhase && !inFailureCooldown;
  const isDetectPhase  = isStale && activeTensionCount === 0 && !isSynthPhase && !isResumedPhase && !inFailureCooldown;

  const overlayVariant = (isSynthPhase || isResumedPhase) ? 'synth' : isConflictPhase ? 'conflict' : 'detect';
  const overlayMsg = isResumedPhase
    ? (resumeThinkingMsg || 'AI 仍在后台合成中,刷新前的进度已接力上来…')
    : isSynthPhase
    ? (thinkingMsg || (isFirstPending && !streamActive ? '连接 AI…' : 'AI 正在合成…'))
    : isConflictPhase
    ? `发现 ${activeTensionCount} 个意图冲突 — 解决后 AI 将自动合成新版本`
    : 'AI 正在检测意图冲突…';

  const showOverlay = isSynthPhase || isConflictPhase || isDetectPhase || isResumedPhase;

  return (
    <div className="canvas-result" style={{ position: 'relative' }}>
      {/* 失败 banner — 合成被超时/出错杀掉后给用户清晰反馈和重试入口 */}
      {inFailureCooldown && !isSynthPhase && (
        <div className="canvas-failure-banner" role="alert" style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px',
          background: 'linear-gradient(90deg, #FEF2F2, #FFFBEB)',
          borderBottom: '1px solid #FCA5A5',
          color: '#7F1D1D', fontSize: 13, lineHeight: 1.4,
        }}>
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span style={{ flex: 1 }}>
            上次合成中断{synthFailureMsg ? `: ${synthFailureMsg}` : ''}。已暂停自动重试,你可以继续添加意图,然后手动点击下方按钮重新合成。
          </span>
          <button
            type="button"
            onClick={() => {
              onRetrySynth?.();
              // 主动触发: 用 runSynthesis (流式 SSE)
              const hash = hashIntents(intents);
              void runSynthesis(hash);
            }}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 6,
              border: 0, background: '#1A1A1C', color: '#fff',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >
            重新合成
          </button>
        </div>
      )}

      {/* 统一 Thinking 覆盖层: 冲突检测 → 冲突阻塞 → 流式合成 */}
      {showOverlay && (
        <div className={`canvas-thinking-overlay canvas-thinking-overlay--${overlayVariant}`}>
          <span className="canvas-thinking-pulse" />
          <span className="canvas-thinking-msg">{overlayMsg}</span>
          {/* 扫光条:仅合成阶段显示 */}
          {isSynthPhase && <span className="canvas-thinking-bar" />}
          {/* 冲突阶段:显示冲突数角标 */}
          {isConflictPhase && (
            <span className="canvas-thinking-badge">{activeTensionCount}</span>
          )}
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
          key={streamActive ? 'streaming' : (displayVersion?.id ?? 'resumed')}
          ref={iframeRef}
          onLoad={handleIframeLoad}
          className={`canvas-frame${(streamActive || isResumedPhase) ? ' canvas-frame-streaming' : ''}`}
          srcDoc={displayContent}
          title={`${project.name} · synthesized preview`}
          // allow-scripts: 让导入页里的动效 (scroll-reveal / count-up / parallax 等
          //   JS 驱动的 motion) 能在 iframe 内跑起来; CSS-only 动效一直都能跑, JS 现在补齐。
          // allow-same-origin: 保留 — ProjectCanvas 大量依赖 iframe.contentDocument 做
          //   Intent ↔ section 高亮、溯源 pill、scroll-into-view, 去掉会全废。
          // allow-popups + allow-popups-to-escape-sandbox: <a target="_blank"> 真开新窗口。
          // 安全模型: Darwin 是私有协作工具, iframe 内 HTML 全来自团队成员或他们触发
          //   的 AI 输出, 没有匿名 untrusted 上传路径; 同源条件下 iframe JS 能读 darwin
          //   cookie 的风险是用户对自己的代码负责。
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      ) : (
        <pre className="canvas-md">{streamActive ? streamBufRef.current || displayContent : displayContent}</pre>
      )}

      <div className="canvas-result-foot">
        <div className="canvas-result-meta">
          {/* 所有 AI 工作阶段 (检测/冲突/合成) 均由顶部 thinking overlay 统一展示 */}
          {showOverlay ? null : error ? (
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
          ) : displayVersion ? (
            <>
              <span
                className={`canvas-source-pill canvas-source-${displaySourceMeta.cls}`}
                title={displaySourceMeta.title}
              >
                {displaySourceMeta.label}
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
          ) : null}
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
