'use client';

/**
 * 协作者管理面板 — 详情页顶栏点击头像群弹出。
 *
 * 当前协作者打勾,点其他员工加入,取消勾选移除。
 * Owner (徐鑫) 锁定不可移。
 *
 * 提交后调 PATCH /api/projects/:id/collaborators,服务端整体替换。
 */

import { useEffect, useMemo, useState } from 'react';
import type { Employee } from '@/lib/employees';

const OWNER_ID = '00000000-0000-0000-0000-000000000001';

type Props = {
  open: boolean;
  projectId: string;
  current: Employee[];
  onClose: () => void;
  onSaved: (next: Employee[]) => void;
};

export default function CollaboratorsPanel({
  open,
  projectId,
  current,
  onClose,
  onSaved,
}: Props) {
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // mount / re-open 时拉员工列表 + 重置 selected
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(current.map(c => c.id)));
    setError(null);
    setLoading(true);
    fetch('/api/employees')
      .then(r => r.json())
      .then(j => {
        if (j.ok) setAllEmployees(j.employees);
        else setError(j.error || '加载员工列表失败');
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  const grouped = useMemo(() => {
    const humans = allEmployees.filter(e => e.kind === 'human');
    const standaloneAgents = allEmployees.filter(
      e => e.kind === 'agent' && !e.linkedHumanId
    );
    const twinByHumanId = new Map<string, Employee>();
    for (const e of allEmployees) {
      if (e.kind === 'agent' && e.linkedHumanId) {
        twinByHumanId.set(e.linkedHumanId, e);
      }
    }
    return { humans, standaloneAgents, twinByHumanId };
  }, [allEmployees]);

  if (!open) return null;

  function toggle(id: string) {
    if (id === OWNER_ID) return; // owner 不可移
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 计算 dirty: selected != current set
  const currentSet = new Set(current.map(c => c.id));
  const dirty =
    selected.size !== currentSet.size ||
    [...selected].some(id => !currentSet.has(id));

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const ids = [...selected].filter(id => id !== OWNER_ID);
      const res = await fetch(
        `/api/projects/${projectId}/collaborators`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collaboratorIds: ids }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `请求失败 (${res.status})`);
        return;
      }
      onSaved(json.collaborators);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => !saving && onClose()}
    >
      <div
        className="modal-panel collab-panel"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="协作者管理"
      >
        <header className="modal-head">
          <h2 className="modal-title">协作者</h2>
          <p className="modal-sub">
            真实员工和 Agent 都可加入。Agent 在沟通时会按人设主动接话。
          </p>
        </header>

        <div className="modal-body">
          {loading ? (
            <div className="ver-empty">加载中…</div>
          ) : allEmployees.length === 0 ? (
            <div className="collab-empty">
              还没有员工。去
              {' '}<a href="/employees" target="_blank" rel="noreferrer">员工管理</a>{' '}
              新增。
            </div>
          ) : (
            <div className="collab-grid">
              {grouped.humans.length > 0 && (
                <>
                  <div className="collab-group-label">真实员工</div>
                  {grouped.humans.map(emp => {
                    const twin = grouped.twinByHumanId.get(emp.id) ?? null;
                    const offlineRecommend = !emp.isOnline && !!twin;
                    return (
                      <div key={emp.id} className="collab-cluster">
                        <CollabRow
                          emp={emp}
                          checked={selected.has(emp.id)}
                          locked={emp.id === OWNER_ID}
                          onToggle={() => toggle(emp.id)}
                          disabled={saving}
                        />
                        {twin && (
                          <CollabRow
                            emp={twin}
                            checked={selected.has(twin.id)}
                            onToggle={() => toggle(twin.id)}
                            disabled={saving}
                            variant={offlineRecommend ? 'twin-recommended' : 'twin'}
                            hint={
                              offlineRecommend
                                ? `${emp.name}离线,推荐让数字分身代为参与`
                                : `${emp.name} 的数字分身`
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
              {grouped.standaloneAgents.length > 0 && (
                <>
                  <div className="collab-group-label">Agent 员工</div>
                  {grouped.standaloneAgents.map(emp => (
                    <CollabRow
                      key={emp.id}
                      emp={emp}
                      checked={selected.has(emp.id)}
                      onToggle={() => toggle(emp.id)}
                      disabled={saving}
                    />
                  ))}
                </>
              )}
            </div>
          )}
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
            disabled={saving || !dirty}
          >
            {saving ? '保存中…' : dirty ? '保存修改' : '没有改动'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function CollabRow({
  emp,
  checked,
  locked = false,
  onToggle,
  disabled,
  variant = 'normal',
  hint,
}: {
  emp: Employee;
  checked: boolean;
  locked?: boolean;
  onToggle: () => void;
  disabled: boolean;
  variant?: 'normal' | 'twin' | 'twin-recommended';
  hint?: string;
}) {
  const isTwin = variant === 'twin' || variant === 'twin-recommended';
  return (
    <button
      type="button"
      className={`collab-row${checked ? ' is-checked' : ''}${locked ? ' is-locked' : ''}${isTwin ? ' is-twin' : ''}${variant === 'twin-recommended' ? ' is-twin-recommended' : ''}`}
      onClick={onToggle}
      disabled={disabled || locked}
      title={locked ? '项目所有者不可移除' : undefined}
    >
      <span className={`avatar ${emp.cls}${emp.kind === 'agent' ? ' agent' : ''}`}>
        {emp.short}
      </span>
      <span className="collab-text">
        <span className="collab-name">
          {emp.name}
          {locked && <span className="collab-locked-tag">所有者</span>}
          {emp.kind === 'human' && !emp.isOnline && (
            <span className="collab-offline-tag">离线</span>
          )}
        </span>
        <span className="collab-role">
          {emp.role}
          {!isTwin && emp.kind === 'agent' && ' · Agent'}
          {hint && <span className="collab-row-hint"> · {hint}</span>}
        </span>
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
