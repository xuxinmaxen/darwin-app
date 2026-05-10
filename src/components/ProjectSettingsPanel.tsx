'use client';

/**
 * 项目设置面板 — 顶栏齿轮按钮触发。
 *
 * v2 当前只暴露最关键的一项: 冲突默认处理 (conflictMode)。
 *   - discuss   = 检测到冲突 → 显示 TensionCard, 团队仲裁
 *   - ai_decide = 检测到冲突 → AI 自动给三个方案打分 + 选最佳, 写决议
 *
 * 后续可加: 项目名 / 背景 / 协作风格等。先按"渐进式展示"原则只放必填项。
 */

import { useEffect, useState } from 'react';
import type { ConflictMode } from '@/lib/types';

type Props = {
  open: boolean;
  projectId: string;
  projectName: string;
  initialMode: ConflictMode;
  onClose: () => void;
  onSaved: (mode: ConflictMode) => void;
};

export default function ProjectSettingsPanel({
  open,
  projectId,
  projectName,
  initialMode,
  onClose,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<ConflictMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
    }
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  async function handleSave() {
    if (mode === initialMode) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conflictMode: mode }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || '保存失败');
        return;
      }
      onSaved(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div
        className="modal-panel proj-settings-panel"
        onClick={e => e.stopPropagation()}
        role="dialog"
      >
        <header className="modal-head">
          <h2 className="modal-title">项目设置</h2>
          <p className="modal-sub">
            「{projectName}」· 这些设置只影响当前项目。
          </p>
        </header>

        <div className="modal-body">
          <div className="field">
            <label className="field-label">冲突默认处理</label>
            <div className="conflict-mode-picker">
              <button
                type="button"
                className={`cmode-opt${mode === 'discuss' ? ' active' : ''}`}
                onClick={() => setMode('discuss')}
                disabled={saving}
              >
                <span className="cmode-opt-head">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M2 5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H6l-3 2v-2a3 3 0 0 1-1-2.5V5z" strokeLinejoin="round" />
                  </svg>
                  开讨论
                </span>
                <span className="cmode-opt-desc">
                  检测到冲突时,AI 给 3 个调和方案,团队在讨论抽屉里仲裁。
                </span>
              </button>
              <button
                type="button"
                className={`cmode-opt${mode === 'ai_decide' ? ' active' : ''}`}
                onClick={() => setMode('ai_decide')}
                disabled={saving}
              >
                <span className="cmode-opt-head">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M7 1.5L8.5 5l3.5 1.2-3.5 1.2L7 11l-1.5-3.5L2 6.2l3.5-1.2z" strokeLinejoin="round" />
                  </svg>
                  AI 评分决策
                </span>
                <span className="cmode-opt-desc">
                  检测到冲突时,AI 给 3 个方案打分 + 选最佳,直接产出决议。团队事后可在讨论里覆盖。
                </span>
              </button>
            </div>
          </div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <footer className="modal-foot">
          <button
            type="button"
            className="ws-btn ws-btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="button"
            className="ws-btn ws-btn-accent"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
