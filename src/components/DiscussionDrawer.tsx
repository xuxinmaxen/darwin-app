'use client';

/**
 * 讨论抽屉 — 项目详情页右侧第三栏。
 *
 * 布局:
 *   - 顶部: thread 标题 + 关闭按钮
 *   - 主体: 消息流 (system / human / agent 三种气泡)
 *   - 底部: 输入框 (resolved 后禁用)
 *   - 如果 thread 关联 active tension, 输入框上方显示 A/B/C 选项栏 (内联仲裁)
 *
 * 数据:
 *   - thread + 它的 messages 由父组件传入
 *   - 父组件负责切换 activeThreadId、发送消息后刷新
 */

import { useEffect, useRef, useState } from 'react';
import type { Thread, ThreadMessage, Tension } from '@/lib/types';
import type { Employee } from '@/lib/employees';

const DEMO_USER = { id: '00000000-0000-0000-0000-000000000001', name: '徐鑫', cls: 'xu', short: '徐' };

type Props = {
  open: boolean;
  thread: Thread | null;
  messages: ThreadMessage[];
  /** 该 thread 关联的 tension (如果有), 用于内联 A/B/C 仲裁 */
  tension?: Tension | null;
  employeeMap: Map<string, Employee>;
  onClose: () => void;
  onSend: (body: string) => Promise<void>;
  onResolveTension: (selectedOptionKey: string) => Promise<void>;
};

export default function DiscussionDrawer({
  open,
  thread,
  messages,
  tension,
  employeeMap,
  onClose,
  onSend,
  onResolveTension,
}: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 新消息进来后滚到底
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length, thread?.id]);

  if (!open) return null;

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(trimmed);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleResolve(key: string) {
    if (resolving) return;
    setResolving(key);
    setError(null);
    try {
      await onResolveTension(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(null);
    }
  }

  const showTensionInlineOptions =
    tension && tension.status === 'active' && thread?.status === 'active';
  const isResolved = thread?.status === 'resolved';

  return (
    <aside className="thread-pane">
      <header className="drawer-head">
        <div className="drawer-head-text">
          <div className="drawer-title">
            {thread?.title ?? '讨论'}
            {isResolved && <span className="drawer-resolved-tag">已收敛</span>}
          </div>
          <div className="drawer-sub">
            {thread?.scope ? `scope · ${thread.scope}` : '团队讨论'}
          </div>
        </div>
        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          title="关闭抽屉"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="drawer-list" ref={listRef}>
        {!thread ? (
          <div className="drawer-empty">还没选讨论。</div>
        ) : messages.length === 0 ? (
          <div className="drawer-empty">这条 thread 还没人说话。</div>
        ) : (
          messages.map(m => (
            <MessageBubble key={m.id} message={m} employeeMap={employeeMap} />
          ))
        )}
      </div>

      {showTensionInlineOptions && tension && (
        <div className="drawer-options">
          <div className="drawer-options-label">
            选一个方案直接定: AI 是调和者, 你是仲裁者
          </div>
          <div className="drawer-options-grid">
            {tension.options.map(opt => (
              <button
                key={opt.key}
                type="button"
                className="drawer-opt"
                onClick={() => handleResolve(opt.key)}
                disabled={resolving !== null}
              >
                <span className="drawer-opt-key">{opt.key}</span>
                <span className="drawer-opt-title">{opt.title}</span>
                {resolving === opt.key && <span className="drawer-opt-spinner" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="drawer-error">
          ⚠️ {error}
          <button type="button" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {isResolved ? (
        <div className="drawer-resolved-foot">
          这条讨论已收敛,产物按定稿方案合成。
        </div>
      ) : (
        <div className="drawer-input">
          <span className={`avatar ${DEMO_USER.cls}`}>{DEMO_USER.short}</span>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="加入讨论…"
            rows={2}
            disabled={sending}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            type="button"
            className="drawer-send"
            onClick={handleSend}
            disabled={sending || !draft.trim()}
          >
            {sending ? '…' : '发送'}
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── Message bubble ────────────────────────────────────────

function MessageBubble({
  message,
  employeeMap,
}: {
  message: ThreadMessage;
  employeeMap: Map<string, Employee>;
}) {
  if (message.authorKind === 'system') {
    return (
      <div className={`msg msg-system${message.isDecision ? ' is-decision' : ''}`}>
        <span className="msg-system-icon">{message.isDecision ? '✓' : 'ⓘ'}</span>
        <span
          className="msg-system-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdownLite(message.body) }}
        />
      </div>
    );
  }

  const author = employeeMap.get(message.authorId);
  const isAgent = message.authorKind === 'agent';
  const cls = author?.cls ?? (isAgent ? 'agent-blue' : 'xu');
  const short = author?.short ?? '?';
  const name = author?.name ?? (isAgent ? 'Agent' : '匿名');

  return (
    <div className={`msg msg-${message.authorKind}${isAgent && author ? ' msg-agent' : ''}`}>
      <span className={`avatar ${cls}${isAgent ? ' agent' : ''}`}>{short}</span>
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-author">{name}</span>
          <span className="msg-time">{relTime(message.createdAt)}</span>
        </div>
        <div
          className="msg-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdownLite(message.body) }}
        />
      </div>
    </div>
  );
}

/** 极简 markdown: 仅转 **strong** 和换行。其他内容 escape。 */
function renderMarkdownLite(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
