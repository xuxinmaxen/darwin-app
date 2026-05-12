'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL, NEW_PROJECT_TYPES } from '@/lib/type-meta';

function formatRelativeTime(iso: string) {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((now - t) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

const MAX_AVATARS_VISIBLE = 4;

const EDIT_ICON = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M2 10v-2l6-6 2 2-6 6H2zM7 3l2 2" />
  </svg>
);
const DELETE_ICON = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 4h6v6.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5V4zM2 4h8M5 2h2v2H5z" />
  </svg>
);

export default function ProjectCard({
  project,
  intentCount,
  collaborators,
}: {
  project: Project;
  intentCount: number;
  preview?: string;
  collaborators: Employee[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm-delete'>('idle');
  const [name, setName] = useState(project.name);
  const [type, setType] = useState(project.type);
  const [conflictMode, setConflictMode] = useState<'discuss' | 'ai_decide'>(project.conflictMode as 'discuss' | 'ai_decide');
  const [background, setBackground] = useState(project.background ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const previewText = project.background?.trim() || '暂无项目背景描述。';

  function closeModal() {
    if (isPending) return;
    setMode('idle');
    setError(null);
    setName(project.name);
    setBackground(project.background ?? '');
  }

  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setError('项目名称不能为空'); return; }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmedName, background: background.trim() || null, type, conflictMode }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) { setError(json.error || '保存失败'); return; }
        setMode('idle');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 5000);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok || !json.ok) { setError(json.error || '删除失败'); return; }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <div className={`proj${project.status === 'collaborating' || project.status === 'tension' ? ' featured' : ''}`}>
        {/* 悬停操作按钮 — 仿员工卡片交互 */}
        <div className="card-actions">
          <button
            type="button"
            className="card-action-btn"
            onClick={e => { e.preventDefault(); setMode('edit'); }}
            title="编辑项目"
          >{EDIT_ICON}</button>
          <button
            type="button"
            className={`card-action-btn danger${confirming ? ' confirming' : ''}`}
            onClick={e => { e.preventDefault(); handleDelete(); }}
            disabled={isPending}
            title={confirming ? '再点一次确认删除' : '删除项目'}
          >{isPending ? '…' : DELETE_ICON}</button>
        </div>

        <Link href={`/projects/${project.id}`} className="proj-link">
          <div className="proj-head">
            <span className="proj-type">
              <TypeIcon type={project.type} />
              <span>{TYPE_LABEL[project.type]}</span>
            </span>
            <span className={`proj-status ${project.status}`}>
              <span className="dot" />
              {STATUS_LABEL[project.status]}
            </span>
          </div>

          <h3 className="proj-card-name">{project.name}</h3>
          <p className="proj-preview">{previewText}</p>

          <div className="proj-foot">
            <span className="proj-collab">
              {collaborators.slice(0, MAX_AVATARS_VISIBLE).map(e => (
                <span
                  key={e.id}
                  className={`avatar ${e.cls}${e.kind === 'agent' ? ' agent' : ''}`}
                  title={`${e.name}${e.role ? ` · ${e.role}` : ''}${e.kind === 'agent' ? '（Agent）' : ''}`}
                >
                  {e.short}
                </span>
              ))}
              {collaborators.length > MAX_AVATARS_VISIBLE && (
                <span className="avatar avatar-more" title={`还有 ${collaborators.length - MAX_AVATARS_VISIBLE} 位协作者`}>
                  +{collaborators.length - MAX_AVATARS_VISIBLE}
                </span>
              )}
            </span>
            <span className="proj-meta" suppressHydrationWarning>
              <strong>{intentCount}</strong> 条意图
              <span className="proj-meta-sep" />
              {formatRelativeTime(project.updatedAt)}
            </span>
          </div>
        </Link>
      </div>

      {/* 编辑模态 */}
      {mode === 'edit' && (
        <div className="modal-backdrop" onClick={closeModal}>
          <form className="modal-panel modal-panel-lg" onClick={e => e.stopPropagation()} onSubmit={handleSaveEdit}>
            <header className="modal-head">
              <h2 className="modal-title">编辑项目</h2>
              <p className="modal-sub">「{project.name}」· 修改后已有的意图和版本不受影响。</p>
            </header>
            <div className="modal-body">
              <div className="field">
                <label className="field-label" htmlFor="pc-name">
                  项目名称 <span className="field-required">*</span>
                </label>
                <input
                  id="pc-name" className="field-input" type="text"
                  value={name} onChange={e => setName(e.target.value)}
                  disabled={isPending} placeholder="给项目起个名字"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="pc-bg">项目背景</label>
                <textarea
                  id="pc-bg" className="field-input field-textarea" rows={3}
                  value={background} onChange={e => setBackground(e.target.value)}
                  disabled={isPending} placeholder="目标受众、关键约束。Agent 会读这段做参考。（可选）"
                />
              </div>
              <div className="field">
                <label className="field-label">产物类型 <span className="field-required">*</span></label>
                <div className="type-grid">
                  {NEW_PROJECT_TYPES.map(t => (
                    <button
                      key={t} type="button"
                      className={`type-opt${type === t ? ' active' : ''}`}
                      onClick={() => setType(t)} disabled={isPending}
                    >
                      <TypeIcon type={t} />
                      <span>{TYPE_LABEL[t]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="field-label">冲突处理方式</label>
                <div className="conflict-mode-grid">
                  <button
                    type="button"
                    className={`conflict-mode-opt${conflictMode === 'discuss' ? ' active' : ''}`}
                    onClick={() => setConflictMode('discuss')}
                    disabled={isPending}
                  >
                    <span className="conflict-mode-icon">💬</span>
                    <span className="conflict-mode-title">开讨论</span>
                    <span className="conflict-mode-desc">AI 给调和方案，团队在讨论框里仲裁。</span>
                  </button>
                  <button
                    type="button"
                    className={`conflict-mode-opt${conflictMode === 'ai_decide' ? ' active' : ''}`}
                    onClick={() => setConflictMode('ai_decide')}
                    disabled={isPending}
                  >
                    <span className="conflict-mode-icon">✦</span>
                    <span className="conflict-mode-title">AI 评分决策</span>
                    <span className="conflict-mode-desc">AI 自动评分选最佳方案，直接产出决议。</span>
                  </button>
                </div>
              </div>

              {error && <div className="modal-error">{error}</div>}
            </div>
            <footer className="modal-foot">
              <button type="button" className="ws-btn ws-btn-ghost" onClick={closeModal} disabled={isPending}>取消</button>
              <button type="submit" className="ws-btn ws-btn-primary" disabled={isPending}>
                {isPending ? '保存中…' : '保存'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* 删除确认模态 */}
      {mode === 'confirm-delete' && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-panel" onClick={e => e.stopPropagation()} role="alertdialog">
            <header className="modal-head">
              <h2 className="modal-title">删除项目「{project.name}」？</h2>
              <p className="modal-sub">项目下所有 Intent、版本、讨论都会一并删除，无法恢复。</p>
            </header>
            {error && <div className="modal-error">{error}</div>}
            <footer className="modal-foot">
              <button type="button" className="ws-btn ws-btn-ghost" onClick={closeModal} disabled={isPending}>取消</button>
              <button type="button" className="ws-btn ws-btn-danger-solid" onClick={() => {
                startTransition(async () => {
                  try {
                    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
                    const json = await res.json();
                    if (!res.ok || !json.ok) { setError(json.error || '删除失败'); return; }
                    setMode('idle');
                    router.refresh();
                  } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                });
              }} disabled={isPending}>
                {isPending ? '删除中…' : '确认删除'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
