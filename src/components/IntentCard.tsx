'use client';

/**
 * Intent 卡片（看板里）— Client Component（带删除）。
 * 视觉对齐 demo 的 .intent。
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Intent } from '@/lib/types';

const AUTHOR_AVATAR_CLS = 'xu'; // V1 单人 demo owner，统一显示徐
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

  function handleDelete() {
    if (!confirm(`删除这条 Intent？\n「${intent.statement}」`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/intents/${intent.id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
      else alert('删除失败');
    });
  }

  const isAgent = intent.authorKind === 'agent';
  const avatarCls = isAgent ? 'agent' : AUTHOR_AVATAR_CLS;
  const short = isAgent ? 'A' : AUTHOR_SHORT;
  const name = isAgent ? 'Agent' : AUTHOR_NAME;
  const role = isAgent ? 'AI' : AUTHOR_ROLE;

  return (
    <div className="intent">
      <div className="intent-head">
        <span className={`avatar ${avatarCls}`}>{short}</span>
        <span className="intent-author">{name}</span>
        <span className="intent-role">/ {role}</span>
        <span className="intent-time">{formatTime(intent.createdAt)}</span>
      </div>
      <p className="intent-body">{intent.statement}</p>
      <div className="intent-meta">
        <span className="tag">{intent.type}</span>
        <span className="tag scope">{intent.scope}</span>
        <span className={`tag ${intent.weight}`}>{intent.weight}</span>
        <button
          type="button"
          className="intent-del"
          onClick={handleDelete}
          disabled={isPending}
          title="删除这条 Intent"
        >
          {isPending ? '删除中…' : '删除'}
        </button>
      </div>
    </div>
  );
}
