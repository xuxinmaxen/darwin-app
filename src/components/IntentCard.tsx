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

const AUTHOR_AVATAR_CLS = 'xu';
const AUTHOR_SHORT = '徐';
const AUTHOR_NAME = '徐鑫';
const AUTHOR_ROLE = '产品';

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

export default function IntentCard({ intent }: { intent: Intent }) {
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

  const isAgent = intent.authorKind === 'agent';
  const avatarCls = isAgent ? 'agent' : AUTHOR_AVATAR_CLS;
  const short = isAgent ? 'A' : AUTHOR_SHORT;
  const name = isAgent ? 'Agent' : AUTHOR_NAME;
  const role = isAgent ? 'AI' : AUTHOR_ROLE;

  return (
    <div className={`intent${confirming ? ' intent-confirming' : ''}`}>
      <div className="intent-head">
        <span className={`avatar ${avatarCls}`}>{short}</span>
        <span className="intent-author">{name}</span>
        <span className="intent-role">/ {role}</span>
        {/* suppressHydrationWarning: 服务端 vs 客户端渲染相差一分钟时,React 会警告 */}
        <span className="intent-time" suppressHydrationWarning>
          {formatTime(intent.createdAt)}
        </span>
      </div>
      <p className="intent-body">{intent.statement}</p>
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
