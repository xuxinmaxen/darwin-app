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

const AGENT_REACT_REFRESH_DELAY_MS = 8000;

export default function IntentForm({
  projectId,
  agents = [],
}: {
  projectId: string;
  /** 项目里的 Agent 协作者; 提交后并发触发它们各自决定是否接话 */
  agents?: Employee[];
}) {
  const router = useRouter();
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [thinkingAgents, setThinkingAgents] = useState<Employee[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  function fireAgentReactions(triggerIntentId: string) {
    if (agents.length === 0) return;
    setThinkingAgents(agents);
    const inflight = agents.map(a =>
      fetch(`/api/projects/${projectId}/agent-react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentEmployeeId: a.id,
          triggerIntentId,
        }),
      }).catch(() => {/* swallow per-agent errors, others may still react */})
    );
    // 等所有 agent 决定完(或全失败), 再 refresh 看板
    Promise.allSettled(inflight).finally(() => {
      setThinkingAgents([]);
      router.refresh();
    });
    // 兜底: 万一 LLM 卡死, 8s 后强制 refresh
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      setThinkingAgents([]);
      router.refresh();
    }, AGENT_REACT_REFRESH_DELAY_MS);
  }

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
        <div className="quickbar-thinking">
          <span className="quickbar-thinking-pulse" />
          <span className="quickbar-thinking-text">
            {thinkingAgents.map(a => a.name).join(' / ')} 在看你这条…
          </span>
        </div>
      )}

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
