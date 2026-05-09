'use client';

/**
 * 新建项目 — 工具栏按钮 + 模态。
 *
 * 点击按钮打开模态：项目名称 + 类型选择器（4 选 1）+ 背景说明（可选）。
 * 创建成功后跳转到项目详情页。
 */

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import { TYPE_LABEL, TypeIcon } from '@/lib/type-meta';

const TYPES: Project['type'][] = ['html', 'ppt', 'doc', 'design'];
const OWNER_ID = '00000000-0000-0000-0000-000000000001';

function CollabCheck({
  emp,
  checked,
  onToggle,
  disabled,
}: {
  emp: Employee;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={`collab-row${checked ? ' is-checked' : ''}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className={`avatar ${emp.cls}${emp.kind === 'agent' ? ' agent' : ''}`}>
        {emp.short}
      </span>
      <span className="collab-text">
        <span className="collab-name">{emp.name}</span>
        <span className="collab-role">{emp.role}</span>
      </span>
      <span className={`collab-check${checked ? ' on' : ''}`} aria-hidden>
        {checked && (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M2.5 6.5L5 9l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default function NewProjectButton({
  employees,
}: {
  employees: Employee[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<Project['type']>('html');
  const [background, setBackground] = useState('');
  const [collaboratorIds, setCollaboratorIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // owner 之外可勾选的员工 (owner 默认在,不渲染)
  const selectable = employees.filter(e => e.id !== OWNER_ID);
  const humans = selectable.filter(e => e.kind === 'human');
  const agents = selectable.filter(e => e.kind === 'agent');

  function toggleCollab(id: string) {
    setCollaboratorIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, isPending]);

  function close() {
    if (isPending) return;
    setOpen(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入项目名称');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            type,
            background: background.trim() || undefined,
            collaboratorIds: Array.from(collaboratorIds),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        // Stay on workspace and refresh — let the user see the new card
        // appear at the top of the list. They can click in when ready.
        setOpen(false);
        setName('');
        setBackground('');
        setType('html');
        setCollaboratorIds(new Set());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="ws-btn ws-btn-primary"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M6 2v8M2 6h8" />
        </svg>
        新建项目
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close}>
          <form
            className="modal-panel"
            onClick={e => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <header className="modal-head">
              <h2 className="modal-title">新建项目</h2>
              <p className="modal-sub">从一句话开始。Intent 会持续在这里沉淀。</p>
            </header>

            <div className="modal-body">
              <div className="field">
                <label className="field-label" htmlFor="np-name">项目名称</label>
                <input
                  id="np-name"
                  className="field-input"
                  type="text"
                  value={name}
                  placeholder="例：AI 编码工具产品发布页"
                  onChange={e => setName(e.target.value)}
                  disabled={isPending}
                  autoFocus
                />
              </div>

              <div className="field">
                <label className="field-label">产物形态</label>
                <div className="type-grid">
                  {TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      className={`type-pick${type === t ? ' active' : ''}`}
                      onClick={() => setType(t)}
                      disabled={isPending}
                    >
                      <TypeIcon type={t} />
                      <span>{TYPE_LABEL[t]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="np-bg">项目背景（可选）</label>
                <textarea
                  id="np-bg"
                  className="field-input field-textarea"
                  value={background}
                  placeholder="一两句话描述目标受众、关键约束。Agent 会读这段做参考。"
                  onChange={e => setBackground(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="field">
                <label className="field-label">
                  邀请协作者
                  <span className="field-hint">
                    — 你已自动加入。Agent 会按人设主动贡献 Intent
                  </span>
                </label>
                {selectable.length === 0 ? (
                  <div className="collab-empty">
                    还没有其他员工。去
                    {' '}<a href="/employees" target="_blank" rel="noreferrer">员工管理</a>{' '}
                    新增真实成员或 Agent。
                  </div>
                ) : (
                  <div className="collab-grid">
                    {humans.length > 0 && (
                      <>
                        <div className="collab-group-label">真实员工</div>
                        {humans.map(emp => (
                          <CollabCheck
                            key={emp.id}
                            emp={emp}
                            checked={collaboratorIds.has(emp.id)}
                            onToggle={() => toggleCollab(emp.id)}
                            disabled={isPending}
                          />
                        ))}
                      </>
                    )}
                    {agents.length > 0 && (
                      <>
                        <div className="collab-group-label">Agent 员工</div>
                        {agents.map(emp => (
                          <CollabCheck
                            key={emp.id}
                            emp={emp}
                            checked={collaboratorIds.has(emp.id)}
                            onToggle={() => toggleCollab(emp.id)}
                            disabled={isPending}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {error && <div className="modal-error">{error}</div>}

            <footer className="modal-foot">
              <button
                type="button"
                className="ws-btn ws-btn-ghost"
                onClick={close}
                disabled={isPending}
              >
                取消
              </button>
              <button
                type="submit"
                className="ws-btn ws-btn-accent"
                disabled={isPending || !name.trim()}
              >
                {isPending ? '创建中…' : '创建项目'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
