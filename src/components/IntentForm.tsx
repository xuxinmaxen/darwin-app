'use client';

/**
 * Intent input form (Client Component).
 *
 * V1: just statement → POST. type/scope/weight default to Goal/global/should
 * server-side. Phase 3 will route through /api/extract for Claude抽取.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function IntentForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = statement.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statement: trimmed }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        setStatement('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-200 bg-white p-4"
    >
      <div className="flex items-start gap-2">
        <textarea
          value={statement}
          onChange={e => setStatement(e.target.value)}
          placeholder="说一句你想要什么,可以尽情表达…"
          rows={2}
          disabled={isPending}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="min-h-[60px] flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isPending || !statement.trim()}
          className="self-stretch rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? '添加中…' : '添加 ↵'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        V1 暂不接 Claude 抽取,先以默认 type/scope/weight 入库。Cmd/Ctrl + Enter 快捷提交。
      </p>
      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </form>
  );
}
