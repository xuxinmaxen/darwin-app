'use client';

/**
 * 团队共识候选 toast — tension 解决后, AI 抽出"值得沉淀"的取向时弹出。
 *
 * 设计:
 *   - 不弹模态 (会盖住产物), 浮在画布右下角
 *   - 默认展示 LLM 的拟态 (icon + category + body)
 *   - 一次只展示一条, 多条排队 (前一条处理完才出下一条)
 *   - 三个动作: 沉淀 / 编辑 / 弃用
 *
 * 编辑模式: inline 改 category + body (icon 不在这里改, 真要改去 /memory 编辑)。
 */

import { useState } from 'react';
import type { PrefCandidate } from '@/lib/types';

const ICON_MAP: Record<string, string> = {
  pen: '✎', eye: '◉', graph: '⤴', audience: '◎', flow: '↺', note: '✱',
};

type Props = {
  candidate: PrefCandidate;
  onAccepted: (id: string) => void;
  onDismissed: (id: string) => void;
};

export default function PrefCandidateToast({
  candidate,
  onAccepted,
  onDismissed,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draftCategory, setDraftCategory] = useState(candidate.category);
  const [draftBody, setDraftBody] = useState(candidate.body);
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (busy) return;
    setBusy('accept');
    setError(null);
    try {
      const patch = editing
        ? { category: draftCategory.trim(), body: draftBody.trim() }
        : undefined;
      const res = await fetch(`/api/pref-candidates/${candidate.id}/accept`, {
        method: 'POST',
        headers: patch ? { 'Content-Type': 'application/json' } : undefined,
        body: patch ? JSON.stringify(patch) : undefined,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || '沉淀失败');
        return;
      }
      onAccepted(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss() {
    if (busy) return;
    setBusy('dismiss');
    setError(null);
    try {
      const res = await fetch(`/api/pref-candidates/${candidate.id}/dismiss`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || '弃用失败');
        return;
      }
      onDismissed(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pref-toast rainbow-sweep" role="alert">
      <div className="pref-toast-head">
        <span className="pref-toast-tag">
          <span className="dot" />
          团队共识候选
        </span>
        {candidate.sourceHint && (
          <span className="pref-toast-hint">来自 · {candidate.sourceHint}</span>
        )}
      </div>

      <div className="pref-toast-body">
        <span className="pref-toast-icon" aria-hidden>
          {ICON_MAP[candidate.iconKey] ?? '✱'}
        </span>
        <div className="pref-toast-text">
          {editing ? (
            <>
              <input
                type="text"
                className="pref-toast-input"
                value={draftCategory}
                onChange={e => setDraftCategory(e.target.value)}
                placeholder="类别 (例: 视觉风格)"
                disabled={busy !== null}
              />
              <textarea
                className="pref-toast-input pref-toast-textarea"
                value={draftBody}
                onChange={e => setDraftBody(e.target.value)}
                rows={3}
                disabled={busy !== null}
              />
            </>
          ) : (
            <>
              <div className="pref-toast-cat">{candidate.category}</div>
              <div
                className="pref-toast-text-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdownLite(candidate.body) }}
              />
            </>
          )}
        </div>
      </div>

      {error && <div className="pref-toast-error">⚠️ {error}</div>}

      <div className="pref-toast-foot">
        <button
          type="button"
          className="ws-btn ws-btn-ghost pref-toast-btn"
          onClick={handleDismiss}
          disabled={busy !== null}
        >
          {busy === 'dismiss' ? '弃用中…' : '不沉淀'}
        </button>
        {!editing ? (
          <button
            type="button"
            className="ws-btn ws-btn-ghost pref-toast-btn"
            onClick={() => setEditing(true)}
            disabled={busy !== null}
          >
            编辑
          </button>
        ) : (
          <button
            type="button"
            className="ws-btn ws-btn-ghost pref-toast-btn"
            onClick={() => {
              setEditing(false);
              setDraftCategory(candidate.category);
              setDraftBody(candidate.body);
            }}
            disabled={busy !== null}
          >
            撤回编辑
          </button>
        )}
        <button
          type="button"
          className="ws-btn ws-btn-accent pref-toast-btn"
          onClick={handleAccept}
          disabled={busy !== null || (editing && (!draftCategory.trim() || !draftBody.trim()))}
        >
          {busy === 'accept' ? '沉淀中…' : '沉淀为共识'}
        </button>
      </div>
    </div>
  );
}

function renderMarkdownLite(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}
