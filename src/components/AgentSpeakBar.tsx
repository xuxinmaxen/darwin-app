'use client';

/**
 * Agent 发言条 — 看板底部 IntentForm 上方。
 *
 * 把项目 collaborators 里的 Agent 显示成一行 chip,点击触发
 * POST /api/projects/[id]/agent-speak,LLM 按 persona 生成一条 Intent。
 *
 * 没有 Agent 协作者时整条不渲染 (省视觉)。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Employee } from '@/lib/employees';

export default function AgentSpeakBar({
  projectId,
  agents,
}: {
  projectId: string;
  agents: Employee[];
}) {
  const router = useRouter();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (agents.length === 0) return null;

  async function speak(agent: Employee) {
    setSpeakingId(agent.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-speak`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentEmployeeId: agent.id }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `请求失败 (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpeakingId(null);
    }
  }

  return (
    <div className="agent-speak-bar">
      <span className="agent-speak-label">让 AI 员工先发言</span>
      <div className="agent-speak-chips">
        {agents.map(a => {
          const isSpeaking = speakingId === a.id;
          return (
            <button
              key={a.id}
              type="button"
              className={`agent-speak-chip${isSpeaking ? ' is-speaking' : ''}`}
              onClick={() => speak(a)}
              disabled={speakingId !== null}
              title={a.persona ?? '没填人设,会用通用视角'}
            >
              <span className={`avatar ${a.cls} agent`}>{a.short}</span>
              <span className="agent-speak-name">{a.name}</span>
              <span className="agent-speak-role">{a.role}</span>
              {isSpeaking && <span className="agent-speak-spinner" />}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="agent-speak-error">
          ⚠️ {error}
          <button type="button" onClick={() => setError(null)} aria-label="dismiss">×</button>
        </div>
      )}
    </div>
  );
}
