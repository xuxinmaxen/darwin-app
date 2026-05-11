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

type Attachment = {
  name: string;
  isText: boolean;
  text?: string;
  note?: string;
};

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

  // 附件: 用户在 Intent 上挂的参考文件 (会拼到 statement 给 LLM 读)
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleAttachFile(file: File) {
    setAttaching(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import/file', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `附件读取失败 (${res.status})`);
        return;
      }
      setAttachments(prev => [
        ...prev,
        { name: json.name, isText: json.isText, text: json.text, note: json.note },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
    if (!trimmed && attachments.length === 0) return;

    // 拼附件内容到 statement: 用户文字优先, 附件附后, LLM 抽取 / 合成都能读到
    let finalStatement = trimmed;
    if (attachments.length > 0) {
      const refs: string[] = [];
      for (const a of attachments) {
        if (a.isText && a.text) {
          refs.push(`【参考文件: ${a.name}】\n${a.text}`);
        } else {
          refs.push(`【参考文件: ${a.name}】${a.note ?? ''}`);
        }
      }
      finalStatement = trimmed
        ? `${trimmed}\n\n${refs.join('\n\n')}`
        : refs.join('\n\n');
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statement: finalStatement }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        setStatement('');
        setAttachments([]);
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
        <div className="quickbar-thinking rainbow-sweep">
          <span className="quickbar-thinking-text">
            {thinkingAgents.map(a => a.name).join(' / ')} 正在想…
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
            placeholder="想要什么直接说,AI 会理解…  (Enter 发送 · 📎 可附文件)"
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {attachments.length > 0 && (
          <div className="quickbar-attachments">
            {attachments.map((a, i) => (
              <span key={i} className="quickbar-chip">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path d="M7.5 2.5L3 7a2 2 0 1 0 2.83 2.83L10 5.65a3 3 0 0 0-4.24-4.24L1.5 5.67" strokeLinecap="round" />
                </svg>
                <span className="quickbar-chip-name">{a.name}</span>
                <span className="quickbar-chip-kind">{a.isText ? '文本' : '二进制'}</span>
                <button
                  type="button"
                  className="quickbar-chip-x"
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  aria-label={`移除 ${a.name}`}
                  disabled={isPending}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div className="quickbar-foot">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.html,.htm,.json,.csv,.xml,.yaml,.yml,.pptx,.pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleAttachFile(f);
            }}
          />
          <button
            type="button"
            className="quickbar-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || attaching}
            title="附加参考文件 (文本/HTML/Markdown 会被 AI 读到正文; PPT/PDF 只记文件名)"
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path d="M9.5 3L4 8.5a2.5 2.5 0 1 0 3.54 3.54L13 6.5A4 4 0 0 0 7.34 0.85L2 6.17" strokeLinecap="round" />
            </svg>
            {attaching ? '读取中…' : '附件'}
          </button>
          <button
            type="button"
            className="quickbar-submit"
            disabled={isPending || (!statement.trim() && attachments.length === 0)}
            onClick={submit}
          >
            {isPending ? '提交中…' : '提交'}
          </button>
        </div>
      </div>
    </>
  );
}
