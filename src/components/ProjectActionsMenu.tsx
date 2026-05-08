'use client';

/**
 * 项目操作菜单（详情页 topbar 上的 ⋯ 按钮）
 *
 * - 编辑 → 弹模态改 name + background
 * - 删除 → 弹确认模态,DELETE 后跳工作台
 *
 * 不放在工作台卡片上是为了避免 anchor 嵌套 button 的合法性问题,
 * 同时让删除这种破坏性操作必须先进项目内才能触发。
 */

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';

type Mode = 'closed' | 'menu' | 'edit' | 'confirm-delete';

export default function ProjectActionsMenu({
  project,
}: {
  project: Project;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('closed');
  const [name, setName] = useState(project.name);
  const [background, setBackground] = useState(project.background ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // 关闭：点空白 + Esc
  useEffect(() => {
    if (mode === 'closed') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) closeAll();
    }
    function onClick(e: MouseEvent) {
      if (mode !== 'menu') return;
      const target = e.target as Node;
      if (!triggerRef.current?.parentElement?.contains(target)) {
        setMode('closed');
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [mode, isPending]);

  function closeAll() {
    if (isPending) return;
    setMode('closed');
    setError(null);
    setName(project.name);
    setBackground(project.background ?? '');
  }

  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('项目名称不能为空');
      return;
    }
    const trimmedBg = background.trim();
    const noNameChange = trimmedName === project.name;
    const noBgChange = (trimmedBg || null) === (project.background || null);
    if (noNameChange && noBgChange) {
      setMode('closed');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            background: trimmedBg || null,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        setMode('closed');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleConfirmDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'DELETE',
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        router.push('/');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="proj-actions">
      <button
        ref={triggerRef}
        type="button"
        className="proj-actions-trigger"
        onClick={() => setMode(m => (m === 'menu' ? 'closed' : 'menu'))}
        title="项目操作"
        aria-haspopup="menu"
        aria-expanded={mode === 'menu'}
      >
        <svg viewBox="0 0 14 14" fill="currentColor">
          <circle cx="3" cy="7" r="1.3" />
          <circle cx="7" cy="7" r="1.3" />
          <circle cx="11" cy="7" r="1.3" />
        </svg>
      </button>

      {mode === 'menu' && (
        <div className="proj-actions-menu" role="menu">
          <button
            type="button"
            className="proj-actions-item"
            onClick={() => setMode('edit')}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M2 10v-2l6-6 2 2-6 6H2zM7 3l2 2" />
            </svg>
            编辑名称 / 背景
          </button>
          <button
            type="button"
            className="proj-actions-item proj-actions-item-danger"
            onClick={() => setMode('confirm-delete')}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M3 4h6v6.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5V4zM2 4h8M5 2h2v2H5z" />
            </svg>
            删除项目
          </button>
        </div>
      )}

      {mode === 'edit' && (
        <div className="modal-backdrop" onClick={closeAll}>
          <form
            className="modal-panel"
            onClick={e => e.stopPropagation()}
            onSubmit={handleSaveEdit}
          >
            <header className="modal-head">
              <h2 className="modal-title">编辑项目</h2>
              <p className="modal-sub">改名字、补充背景。Intent 不受影响。</p>
            </header>
            <div className="modal-body">
              <div className="field">
                <label className="field-label" htmlFor="ep-name">项目名称</label>
                <input
                  id="ep-name"
                  className="field-input"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={isPending}
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ep-bg">项目背景</label>
                <textarea
                  id="ep-bg"
                  className="field-input field-textarea"
                  value={background}
                  onChange={e => setBackground(e.target.value)}
                  disabled={isPending}
                  placeholder="一两句话描述目标受众、关键约束。"
                />
              </div>
            </div>
            {error && <div className="modal-error">{error}</div>}
            <footer className="modal-foot">
              <button
                type="button"
                className="ws-btn ws-btn-ghost"
                onClick={closeAll}
                disabled={isPending}
              >
                取消
              </button>
              <button
                type="submit"
                className="ws-btn ws-btn-accent"
                disabled={isPending}
              >
                {isPending ? '保存中…' : '保存修改'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div className="modal-backdrop" onClick={closeAll}>
          <div
            className="modal-panel"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
          >
            <header className="modal-head">
              <h2 className="modal-title">删除项目「{project.name}」？</h2>
              <p className="modal-sub">
                项目会被永久删除，包含所有 Intent / Tension / Version。此操作不可撤销。
              </p>
            </header>
            {error && <div className="modal-error">{error}</div>}
            <footer className="modal-foot">
              <button
                type="button"
                className="ws-btn ws-btn-ghost"
                onClick={closeAll}
                disabled={isPending}
              >
                取消
              </button>
              <button
                type="button"
                className="ws-btn ws-btn-danger-solid"
                onClick={handleConfirmDelete}
                disabled={isPending}
              >
                {isPending ? '删除中…' : '确认删除'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
