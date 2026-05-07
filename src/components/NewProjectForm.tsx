'use client';

/**
 * Inline new-project form (Client Component).
 *
 * V1 keep it minimal — name + type only.
 * Phase 2 will add background + conflict mode + collaborator picker.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectType } from '@/lib/types';

const TYPES: Array<{ value: ProjectType; label: string }> = [
  { value: 'html', label: '落地页' },
  { value: 'ppt', label: 'PPT' },
  { value: 'doc', label: '文档' },
  { value: 'design', label: '设计稿' },
];

export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('html');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('请输入项目名称');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), type }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        setName('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-200 bg-white p-5"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        新建项目
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="项目名称"
          disabled={isPending}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
          autoFocus
        />
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              disabled={isPending}
              onClick={() => setType(t.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
                type === t.value
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? '创建中…' : '创建'}
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </form>
  );
}
