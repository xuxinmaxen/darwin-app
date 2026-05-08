'use client';

/**
 * Single Intent card with delete (Client Component for the delete handler).
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Intent } from '@/lib/types';

const TYPE_TONE: Record<Intent['type'], string> = {
  Goal: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Constraint: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  Preference: 'bg-sky-50 text-sky-700 border-sky-200',
  Reference: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  Veto: 'bg-red-50 text-red-700 border-red-200',
};

const WEIGHT_TONE: Record<Intent['weight'], string> = {
  must: 'bg-amber-50 text-amber-700 border-amber-200',
  should: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  nice_to_have: 'bg-zinc-100 text-zinc-600 border-zinc-200',
};

export default function IntentCard({ intent }: { intent: Intent }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`删除这条 Intent?\n「${intent.statement}」`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/intents/${intent.id}`, {
        method: 'DELETE',
      });
      if (res.ok) router.refresh();
      else alert('删除失败');
    });
  }

  const created = new Date(intent.createdAt);

  return (
    <div className="group relative rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[10px] text-zinc-500">
        <span className="font-medium text-zinc-700">
          {intent.authorKind === 'agent' ? '🤖 Agent' : '👤 Human'}
        </span>
        <span>·</span>
        <time>
          {created.toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-30"
        >
          {isPending ? '...' : '删除'}
        </button>
      </div>
      <p className="mb-3 text-sm leading-relaxed text-zinc-900">
        {intent.statement}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <span
          className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
            TYPE_TONE[intent.type]
          }`}
        >
          {intent.type}
        </span>
        <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[10px] text-zinc-600">
          {intent.scope}
        </span>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
            WEIGHT_TONE[intent.weight]
          }`}
        >
          {intent.weight}
        </span>
      </div>
    </div>
  );
}
