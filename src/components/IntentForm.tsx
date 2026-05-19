'use client';

/**
 * Intent 输入框（quickbar 样式，看板底部）— Client Component。
 *
 * - statement → POST /api/projects/:id/intents
 * - 提交成功后,对项目里所有 Agent 协作者并发触发 /agent-react
 *   (fire-and-forget, 各 Agent 自己判断是否要接话)
 * - 延迟 8s 再 refresh, 让看板上呈现 Agent 跟进的 Intent
 */

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Employee } from '@/lib/employees';
import type { Intent } from '@/lib/types';

// Agent 反应安全兜底: LLM 偶尔卡 20-30s, 给宽一点不要太早强制收尾。
// 真实情况下 Promise.allSettled 会先 fire-and-forget 完成。
const AGENT_REACT_REFRESH_DELAY_MS = 25_000;

const URL_RE = /https?:\/\/[^\s"'<>]+/g;

type Attachment = {
  name: string;
  isText: boolean;
  text?: string;
  note?: string;
  /** 图片: data URL 或 Supabase 公开 URL */
  imageUrl?: string;
  /** URL 链接预览 */
  linkUrl?: string;
  /** URL 拉取状态: pending(拉取中) / ok / failed */
  linkFetchStatus?: 'pending' | 'ok' | 'failed';
  /** URL 抽取到的页面标题 (可选,用于 chip 显示) */
  linkTitle?: string | null;
  /** URL 内容是否被截断 (>8000 字) */
  linkTruncated?: boolean;
};

type DarwinAnnotation = {
  id: number;
  label: string;
  selector: string;
  text: string;
  note: string;
};

export default function IntentForm({
  projectId,
  agents = [],
  currentUserCls = 'xu',
  currentUserShort = '我',
  onAgentsReacting,
  onIntentCreated,
  markMode = false,
  setMarkMode,
  readAnnotations,
  clearAnnotations,
}: {
  projectId: string;
  agents?: Employee[];
  currentUserCls?: string;
  currentUserShort?: string;
  /** Agent 反应进行中 (true) / 结束 (false),供父组件阻断自动合成 */
  onAgentsReacting?: (reacting: boolean) => void;
  /**
   * 拿到 API 返回的 intent 立刻调一次。父组件用它把 intent 同步到 client state,
   * 不依赖 router.refresh 等 RSC payload 异步派下来 — 否则会有 race 让自动合成抢跑。
   */
  onIntentCreated?: (intent: Intent) => void;
  /** 标注模式状态 (父组件管理, 这里只读 + toggle) */
  markMode?: boolean;
  setMarkMode?: (on: boolean) => void;
  /** 提交意图时从 iframe 读取当前 pins */
  readAnnotations?: () => DarwinAnnotation[];
  /** 提交成功后清空 iframe 内 pins */
  clearAnnotations?: () => void;
}) {
  const router = useRouter();
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [thinkingAgents, setThinkingAgents] = useState<Employee[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 附件: 用户在 Intent 上挂的参考文件 (会拼到 statement 给 LLM 读)
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleAttachFile(file: File) {
    setAttaching(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import/file', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `附件读取失败 (${res.status})`);
        return;
      }
      setAttachments(prev => [
        ...prev,
        { name: json.name, isText: json.isText, text: json.text, note: json.note },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // 粘贴图片
  async function handlePasteImage(file: File) {
    setAttaching(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import/image', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || '图片上传失败'); return; }
      setAttachments(prev => [...prev, {
        name: file.name || '图片',
        isText: false,
        imageUrl: json.url,
        note: `【参考图片: ${file.name || '图片'}】${json.url}`,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttaching(false);
    }
  }

  // 粘贴 URL — 先添加 pending chip, 后台异步拉取页面正文
  // 拉取成功后, attachment.text 会被替换为含正文的【参考链接】块,
  // LLM 才真的能"读到"链接里的内容并参照其风格/copy 合成产物
  function handlePasteUrl(url: string) {
    let alreadyExists = false;
    setAttachments(prev => {
      if (prev.some(a => a.linkUrl === url)) { alreadyExists = true; return prev; }
      return [
        ...prev,
        {
          name: url, isText: true, linkUrl: url,
          text: `【参考链接】${url}\n(正在拉取页面内容…)`,
          linkFetchStatus: 'pending',
        },
      ];
    });
    if (alreadyExists) return;
    // 后台拉取正文,完成后更新 attachment
    void (async () => {
      try {
        const res = await fetch('/api/import/html', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setAttachments(prev => prev.map(a => a.linkUrl === url ? {
            ...a, linkFetchStatus: 'failed',
            text: `【参考链接】${url}\n(拉取失败: ${json.error || res.status}; LLM 只能看到链接本身,无法读取正文)`,
          } : a));
          return;
        }
        const body = [
          `【参考链接】来源: ${json.url}`,
          json.title ? `标题: ${json.title}` : '',
          '',
          json.text,
          json.truncated ? '[内容已截断 8000 字]' : '',
        ].filter(Boolean).join('\n');
        setAttachments(prev => prev.map(a => a.linkUrl === url ? {
          ...a, linkFetchStatus: 'ok',
          linkTitle: json.title ?? null,
          linkTruncated: !!json.truncated,
          text: body,
        } : a));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAttachments(prev => prev.map(a => a.linkUrl === url ? {
          ...a, linkFetchStatus: 'failed',
          text: `【参考链接】${url}\n(拉取失败: ${msg}; LLM 只能看到链接本身,无法读取正文)`,
        } : a));
      }
    })();
  }

  // textarea paste 事件: 图片 / URL 都走这里
  async function handleTextareaPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) await handlePasteImage(file);
      return;
    }
    // 文本里有 URL → 抽出来
    const text = e.clipboardData.getData('text/plain');
    const urls = text.match(URL_RE);
    if (urls && urls.length > 0 && !text.trim().replace(URL_RE, '').trim()) {
      // 整段都是 URL(没有别的文字)→ 转为 link chip 而不是直接贴进输入框
      e.preventDefault();
      for (const url of urls) handlePasteUrl(url);
    }
    // 否则让浏览器默认处理(正常文字粘贴)
  }

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // 听 darwin-mark.js 在标注面板里点「生成意图」时发的广播 → 把 pins 拼成
  // 【标注修改】 块, 写进 statement 输入框。
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (d && typeof d === 'object' && d.type === 'darwin-mark/generate-intent') {
        generateIntentFromMarks();
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 读 iframe 内 pins → 拼成 【标注修改】 块 → 插入/替换 statement。
   * 如果 statement 已经有 【标注修改】 块, 整块替换 (避免点多次累积重复块);
   * 没有 → 追加在末尾。
   *
   * 用 functional setStatement 是因为这个函数会被 iframe postMessage 监听器调到 —
   * 监听器闭包捕获的 statement 是装载时的值, 必须从 prev 拿最新。
   */
  function generateIntentFromMarks() {
    const anns = readAnnotations?.() ?? [];
    if (anns.length === 0) {
      setError('还没在产物上点 pin');
      setTimeout(() => setError(null), 2400);
      return;
    }
    const block = '【标注修改】\n' + anns.map((a, i) => {
      const note = a.note || '(没写评论 — 见 statement 文字)';
      const meta = a.text ? `${a.selector} · "${a.text}"` : a.selector;
      return `${i + 1}. [${meta}] ${note}`;
    }).join('\n');

    setStatement(prev => {
      const hasBlock = /【标注修改】[\s\S]*?(?=\n\n|$)/.test(prev);
      if (hasBlock) return prev.replace(/【标注修改】[\s\S]*?(?=\n\n|$)/, block);
      if (prev.trim()) return `${prev.trimEnd()}\n\n${block}`;
      return block;
    });
  }

  function fireAgentReactions(triggerIntentId: string) {
    if (agents.length === 0) return;
    setThinkingAgents(agents);
    // 通知父组件: Agent 反应开始 → 阻断自动合成，防止分界线在 agent 意图出现前就定位
    onAgentsReacting?.(true);
    // 用 set 跟踪还没回的 agent — 每个 agent 单独 settle 时立刻 refresh,
    // 不要堆到最后才让用户看到。
    const pending = new Set(agents.map(a => a.id));
    const settle = (agentId: string) => {
      pending.delete(agentId);
      // 增量 refresh: agent 一发言就让看板更新, 不必等其他 agent
      router.refresh();
      if (pending.size === 0) {
        setThinkingAgents([]);
        onAgentsReacting?.(false);
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      } else {
        // 缩 thinking chip,只显示还没回的
        setThinkingAgents(prev => prev.filter(a => pending.has(a.id)));
      }
    };
    for (const a of agents) {
      fetch(`/api/projects/${projectId}/agent-react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentEmployeeId: a.id, triggerIntentId }),
      })
        .then(r => r.json().catch(() => null))
        .then(json => {
          // spoke 时把 agent intent 直接进 client state — 不依赖 RSC payload
          if (json?.ok && json.reaction === 'spoke' && json.intent) {
            onIntentCreated?.(json.intent as Intent);
          }
        })
        .catch(() => {/* 单 agent 失败不致命 */})
        .finally(() => settle(a.id));
    }
    // 兜底: 万一 LLM 卡死, 一定时间后强制收尾
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (pending.size === 0) return;
      pending.clear();
      setThinkingAgents([]);
      router.refresh();
      onAgentsReacting?.(false);
    }, AGENT_REACT_REFRESH_DELAY_MS);
  }

  function submit() {
    setError(null);
    const trimmed = statement.trim();

    // 标注 intent: 看 statement 里是不是已经有 【标注修改】 块 (用户点过「生成意图」)。
    // 不再在提交时自动从 iframe 收 pin — 由用户显式控制何时写入。
    const hasAnnotations = /【标注修改】/.test(trimmed);

    if (!trimmed && attachments.length === 0) return;

    // 拼附件内容到 statement: 用户文字优先, 附件附后, LLM 抽取 / 合成都能读到
    let finalStatement = trimmed;
    if (attachments.length > 0) {
      const refs: string[] = [];
      for (const a of attachments) {
        if (a.imageUrl) {
          // base64 data URL 太长无法塞进 statement; 只用真实 URL 或跳过
          const urlToEmbed = a.imageUrl.startsWith('data:') ? null : a.imageUrl;
          refs.push(urlToEmbed
            ? `【参考图片: ${a.name}】${urlToEmbed}`
            : `【参考图片: ${a.name}】(图片已附上，请结合用户描述进行合成)`);
        } else if (a.linkUrl) {
          // 已拉取页面正文时,把整段【参考链接】块 (含 source / title / 正文) 给 LLM
          // 没拉到 / 还在拉时,a.text 已含拉取状态说明,LLM 至少知道发生了什么
          refs.push(a.text ?? `【参考链接】${a.linkUrl}`);
        } else if (a.isText && a.text) {
          refs.push(`【参考文件: ${a.name}】\n${a.text}`);
        } else {
          refs.push(`【参考文件: ${a.name}】${a.note ?? ''}`);
        }
      }
      finalStatement = finalStatement
        ? `${finalStatement}\n\n${refs.join('\n\n')}`
        : refs.join('\n\n');
    }

    // 标注 intent (statement 里已含 【标注修改】 块) 显式给 type/scope/weight,
    // 跳过 LLM 抽取 (省 500ms + 避免抽错位)
    const explicitMeta = hasAnnotations
      ? { type: 'Constraint' as const, scope: 'global', weight: 'must' as const }
      : {};

    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statement: finalStatement, ...explicitMeta }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        setStatement('');
        setAttachments([]);
        // 标注 pins 不自动清空 — 用户在 panel 里点「清空」自己管;
        // markMode 也不自动关 — 用户可能想继续标注另一组。
        // 直接 push 到 client state (不等 RSC payload), 然后 router.refresh() 做 server 端的
        // 缓存失效。这样用户加的 intent < 1 帧就上看板。
        if (json.intent) onIntentCreated?.(json.intent as Intent);
        router.refresh();
        if (json.intent?.id) {
          fireAgentReactions(json.intent.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      {error && <div className="quickbar-error">{error}</div>}

      {thinkingAgents.length > 0 && (
        <div className="quickbar-thinking rainbow-sweep">
          <span className="quickbar-thinking-text">
            {thinkingAgents.map(a => a.name).join(' / ')} 正在想…
          </span>
        </div>
      )}

      <div className="quickbar">
        <div className="quickbar-row">
          <span className={`avatar ${currentUserCls}`}>{currentUserShort}</span>
          <textarea
            value={statement}
            onChange={e => setStatement(e.target.value)}
            disabled={isPending}
            placeholder="想要什么直接说,AI 会理解…  (Enter 发送 · 📎 附文件 · 可直接粘贴图片或链接)"
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // URL 拉取中,Enter 也不放行,否则 LLM 看不到链接正文
                if (attachments.some(a => a.linkFetchStatus === 'pending')) return;
                submit();
              }
            }}
            onPaste={handleTextareaPaste}
          />
        </div>
        {attachments.length > 0 && (
          <div className="quickbar-attachments">
            {attachments.map((a, i) => (
              <span key={i} className={`quickbar-chip${a.imageUrl ? ' quickbar-chip-image' : a.linkUrl ? ' quickbar-chip-link' : ''}`}>
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.imageUrl} alt={a.name} className="quickbar-chip-thumb" />
                ) : a.linkUrl ? (
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path d="M4.5 6.5a3 3 0 0 0 4.24 0l1.5-1.5a3 3 0 0 0-4.24-4.24l-.83.83" strokeLinecap="round"/>
                    <path d="M7.5 5.5a3 3 0 0 0-4.24 0L1.76 7a3 3 0 0 0 4.24 4.24l.83-.83" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path d="M7.5 2.5L3 7a2 2 0 1 0 2.83 2.83L10 5.65a3 3 0 0 0-4.24-4.24L1.5 5.67" strokeLinecap="round" />
                  </svg>
                )}
                <span className="quickbar-chip-name">
                  {a.linkUrl ? (a.linkTitle || new URL(a.linkUrl).hostname) : a.name}
                </span>
                {a.linkUrl && a.linkFetchStatus === 'pending' && (
                  <span className="quickbar-chip-kind" title="AI 正在拉取该链接的页面正文">读取中…</span>
                )}
                {a.linkUrl && a.linkFetchStatus === 'ok' && (
                  <span className="quickbar-chip-kind" title={a.linkTruncated ? '已抽取正文 (8000 字截断)' : '已抽取正文'}>
                    已读 ✓{a.linkTruncated ? ' (截断)' : ''}
                  </span>
                )}
                {a.linkUrl && a.linkFetchStatus === 'failed' && (
                  <span className="quickbar-chip-kind" title="AI 只能看到链接本身,无法读取正文">读取失败</span>
                )}
                {!a.imageUrl && !a.linkUrl && (
                  <span className="quickbar-chip-kind">{a.isText ? '文本' : '文件'}</span>
                )}
                <button
                  type="button"
                  className="quickbar-chip-x"
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  aria-label={`移除 ${a.name}`}
                  disabled={isPending}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div className="quickbar-foot">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.html,.htm,.json,.csv,.xml,.yaml,.yml,.pptx,.pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleAttachFile(f);
            }}
          />
          <button
            type="button"
            className="quickbar-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || attaching}
            title="附加参考文件 (文本/HTML/Markdown 会被 AI 读到正文; PPT/PDF 只记文件名)"
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path d="M9.5 3L4 8.5a2.5 2.5 0 1 0 3.54 3.54L13 6.5A4 4 0 0 0 7.34 0.85L2 6.17" strokeLinecap="round" />
            </svg>
            {attaching ? '读取中…' : '附件'}
          </button>
          {setMarkMode && (
            <button
              type="button"
              className={`quickbar-attach quickbar-mark${markMode ? ' is-on' : ''}`}
              onClick={() => setMarkMode(!markMode)}
              disabled={isPending}
              title={markMode
                ? '关闭标注 (pin 保留在产物上, 可继续标注或点「生成意图」写入)'
                : '进入标注模式: 在产物上点击元素 → 写评论 → 点「生成意图」插入到输入框'}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M7 1.5L8.65 5L12.5 5.55L9.75 8.25L10.4 12L7 10.25L3.6 12L4.25 8.25L1.5 5.55L5.35 5L7 1.5Z" strokeLinejoin="round" />
              </svg>
              {markMode ? '标注中' : '标注'}
            </button>
          )}
          <button
            type="button"
            className="quickbar-submit"
            disabled={
              isPending ||
              (!statement.trim() && attachments.length === 0) ||
              // 有 URL 拉取中 → 不允许提交,否则 LLM 收到的是空链接
              attachments.some(a => a.linkFetchStatus === 'pending')
            }
            onClick={submit}
            title={
              attachments.some(a => a.linkFetchStatus === 'pending')
                ? '正在抽取链接正文,稍等一下再提交,AI 才能"读到"链接里的内容'
                : undefined
            }
          >
            {isPending
              ? '提交中…'
              : attachments.some(a => a.linkFetchStatus === 'pending')
              ? '读取链接中…'
              : '提交'}
          </button>
        </div>
      </div>
    </>
  );
}
