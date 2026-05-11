'use client';

/**
 * Intent 卡片（看板里）— Client Component。
 *
 * 删除走「点一次进入确认态 → 再点确认才真删」的内联交互,
 * 比 native confirm() 视觉更连贯,也避免无意误删。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Intent } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import { parseStatementForDisplay } from '@/lib/parse-statement';

// 历史/未知 author 兜底
const FALLBACK_HUMAN = { cls: 'xu', short: '徐', name: '徐鑫', role: '产品' };
const FALLBACK_AGENT = { cls: 'agent-blue', short: 'A', name: 'Agent', role: 'AI' };

function formatTime(iso: string) {
  const t = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

export default function IntentCard({
  intent,
  author,
  isHovered = false,
  isDimmed = false,
  onMouseEnter,
  onMouseLeave,
  onDiscuss,
}: {
  intent: Intent;
  /** lookup 出的作者; 找不到时按 authorKind fallback */
  author?: Employee | null;
  isHovered?: boolean;
  isDimmed?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** 围绕这条 Intent 发起讨论 (无 tension 关联) */
  onDiscuss?: (intent: Intent) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDeleteClick() {
    if (!confirming) {
      setConfirming(true);
      // 5 秒不点确认就退出确认态,避免卡住
      window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/intents/${intent.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error || '删除失败');
        setConfirming(false);
      }
    });
  }

  const { userText, attachments, hasImportRef } = parseStatementForDisplay(intent.statement);
  const isAgent = intent.authorKind === 'agent';
  const fallback = isAgent ? FALLBACK_AGENT : FALLBACK_HUMAN;
  const avatarCls = author?.cls
    ? `${author.cls}${isAgent ? ' agent' : ''}`
    : isAgent
      ? `${fallback.cls} agent`
      : fallback.cls;
  const short = author?.short ?? fallback.short;
  const name = author?.name ?? fallback.name;
  const role = author?.role ?? fallback.role;

  return (
    <div
      className={`intent${confirming ? ' intent-confirming' : ''}${isHovered ? ' is-prov-hover' : ''}${isDimmed ? ' is-prov-dim' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="intent-head">
        <span className={`avatar ${avatarCls}`}>{short}</span>
        <span className="intent-author">{name}</span>
        <span className="intent-role">/ {role}</span>
        {/* suppressHydrationWarning: 服务端 vs 客户端渲染相差一分钟时,React 会警告 */}
        <span className="intent-time" suppressHydrationWarning>
          {formatTime(intent.createdAt)}
        </span>
      </div>
      {userText && <p className="intent-body">{userText}</p>}
      {(attachments.length > 0 || hasImportRef) && (
        <div className="intent-attach-row">
          {attachments.map((name, i) => (
            <span key={`a-${i}`} className="intent-attach-chip" title={`AI 已读取参考文件: ${name}`}>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M7.5 2.5L3 7a2 2 0 1 0 2.83 2.83L10 5.65a3 3 0 0 0-4.24-4.24L1.5 5.67" strokeLinecap="round" />
              </svg>
              <span className="intent-attach-name">{name}</span>
            </span>
          ))}
          {hasImportRef && attachments.length === 0 && (
            <span className="intent-attach-chip" title="AI 已读取导入的参考内容">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M3 2.5h4.5L10 5v4.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" strokeLinejoin="round" />
              </svg>
              <span className="intent-attach-name">导入参考</span>
            </span>
          )}
        </div>
      )}
      <div className="intent-meta">
        <span className="tag">{intent.type}</span>
        <span className="tag scope">{intent.scope}</span>
        <span className={`tag ${intent.weight}`}>{intent.weight}</span>
        {confirming && !isPending && (
          <button
            type="button"
            className="intent-del-cancel"
            onClick={() => setConfirming(false)}
          >
            取消
          </button>
        )}
        {onDiscuss && !confirming && (
          <button
            type="button"
            className="intent-discuss"
            onClick={() => onDiscuss(intent)}
            title="围绕这条 Intent 发起讨论"
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M2 4.5a2.5 2.5 0 0 1 2.5-2.5h3A2.5 2.5 0 0 1 10 4.5v2A2.5 2.5 0 0 1 7.5 9H5L3 10.5V9a2.5 2.5 0 0 1-1-2v-2.5z" strokeLinejoin="round" />
            </svg>
            讨论
          </button>
        )}
        <button
          type="button"
          className={`intent-del${confirming ? ' confirming' : ''}`}
          onClick={handleDeleteClick}
          disabled={isPending}
          title={confirming ? '再点一次确认删除' : '删除这条 Intent'}
        >
          {isPending ? '删除中…' : confirming ? '确认删除' : '删除'}
        </button>
      </div>
      {error && <div className="intent-error">{error}</div>}
    </div>
  );
}
