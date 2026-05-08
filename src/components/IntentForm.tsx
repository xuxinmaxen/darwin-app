'use client';

/**
 * Intent 输入框（quickbar 样式，看板底部）— Client Component。
 *
 * V1：直接 statement → POST，type/scope/weight 服务端默认 Goal/global/should。
 * Phase 3 将 POST 路由到 /api/extract 走 Claude 抽取。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function IntentForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
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
    <>
      {error && <div className="quickbar-error">{error}</div>}

      <div className="quickbar">
        <div className="quickbar-row">
          <span className="avatar xu">徐</span>
          <textarea
            value={statement}
            onChange={e => setStatement(e.target.value)}
            disabled={isPending}
            placeholder="说说你想要什么，可以尽情表达…"
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="quickbar-foot">
          <span className="quickbar-hint">
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
            提交
          </span>
          <button
            type="button"
            className="quickbar-submit"
            disabled={isPending || !statement.trim()}
            onClick={submit}
          >
            {isPending ? '添加中…' : '添加 Intent'}
          </button>
        </div>
      </div>
    </>
  );
}
