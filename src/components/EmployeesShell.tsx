'use client';

/**
 * 员工管理页 — Client Component
 *
 * 复用 .view-workspace topbar + sidebar 结构,中间区是员工网格。
 * 视觉对照 v0 demo 的 #ws-section-employees。
 */

import Link from 'next/link';
import { useState } from 'react';
import { Sidebar } from '@/components/WorkspaceShell';
import EmployeeModal from '@/components/EmployeeModal';
import type { Employee } from '@/lib/employees';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

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

export default function EmployeesShell({
  initialEmployees,
  projectsCount,
}: {
  initialEmployees: Employee[];
  projectsCount: number;
}) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(emp: Employee) {
    setEditing(emp);
    setModalOpen(true);
  }
  function handleSaved(saved: Employee) {
    setEmployees(prev => {
      const idx = prev.findIndex(e => e.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setModalOpen(false);
  }

  async function handleConfirmDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `删除失败 (${res.status})`);
        return;
      }
      setEmployees(prev => prev.filter(e => e.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  const confirmDeleteEmp = confirmDeleteId
    ? employees.find(e => e.id === confirmDeleteId)
    : null;

  return (
    <div className="view-workspace">
      <header className="ws-topbar">
        <Link
          href="/"
          className="brand"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="brand-logo" aria-hidden />
          <span className="brand-name">Darwin</span>
          <span className="brand-sub">多人意图合成</span>
        </Link>
        <div className="ws-topbar-spacer" />
      </header>

      <div className="ws-body">
        <Sidebar active="employees" projectsCount={projectsCount} />

        <main className="ws-content">
          <section className="ws-section">
            <div className="ws-hero">
              <div className="ws-hero-eyebrow">
                <span className="dot" />
                员工管理
              </div>
              <h1 className="ws-title">公司员工管理</h1>
              <p className="ws-sub">
                Agent 员工以人设驱动,可以像同事一样加入项目,主动贡献 Intent。
              </p>
            </div>

            <div className="ws-toolbar">
              <div className="ws-section-title">
                团队成员
                <span className="count">{employees.length}</span>
              </div>
              <div className="ws-toolbar-actions">
                <button
                  type="button"
                  className="ws-btn ws-btn-primary"
                  onClick={openNew}
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                    <path d="M6 2v8M2 6h8" />
                  </svg>
                  新增员工
                </button>
              </div>
            </div>

            {error && (
              <div className="emp-list-error">
                ⚠️ {error}
                <button type="button" onClick={() => setError(null)} aria-label="dismiss">×</button>
              </div>
            )}

            <div className="ws-employees">
              {employees.map(emp => {
                const isDefault = emp.id === DEMO_OWNER_ID;
                return (
                  <div
                    key={emp.id}
                    className={`emp${emp.kind === 'agent' ? ' emp-agent' : ''}`}
                  >
                    <div className="card-actions">
                      <button
                        type="button"
                        className="card-action-btn"
                        onClick={() => openEdit(emp)}
                        title="编辑"
                      >
                        {EDIT_ICON}
                      </button>
                      {!isDefault && (
                        <button
                          type="button"
                          className="card-action-btn danger"
                          onClick={() => setConfirmDeleteId(emp.id)}
                          title="删除"
                        >
                          {DELETE_ICON}
                        </button>
                      )}
                    </div>
                    <div className="emp-head">
                      <span className={`avatar ${emp.cls}${emp.kind === 'agent' ? ' agent' : ''}`}>
                        {emp.short}
                      </span>
                      <span className={`emp-kind ${emp.kind}`}>
                        <span className="dot" />
                        {emp.kind === 'agent' ? 'AGENT' : 'HUMAN'}
                      </span>
                    </div>
                    <div className="emp-name">{emp.name}</div>
                    <span className="emp-role">{emp.role}</span>
                    <div className="emp-meta">
                      {emp.kind === 'agent' ? (
                        <>
                          <strong>人设:</strong> {emp.persona || '（未填写）'}
                        </>
                      ) : (
                        <>
                          <strong>邮箱:</strong> {emp.email || '—'}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                className="emp emp-new"
                onClick={openNew}
              >
                <div className="emp-new-icon">
                  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                    <path d="M9 3v12M3 9h12" />
                  </svg>
                </div>
                <div className="emp-new-label">新增员工</div>
                <div className="emp-new-sub">真实员工 / Agent 员工</div>
              </button>
            </div>
          </section>
        </main>
      </div>

      <EmployeeModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />

      {confirmDeleteEmp && (
        <div
          className="modal-backdrop"
          onClick={() => deletingId === null && setConfirmDeleteId(null)}
        >
          <div
            className="modal-panel"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
          >
            <header className="modal-head">
              <h2 className="modal-title">
                删除员工「{confirmDeleteEmp.name}」？
              </h2>
              <p className="modal-sub">
                {confirmDeleteEmp.kind === 'agent'
                  ? '这个 Agent 会从公司员工列表移除。已经留下的 Intent 不受影响。'
                  : '这个真人会从公司员工列表移除。已经留下的 Intent 不受影响。'}
              </p>
            </header>
            <footer className="modal-foot">
              <button
                type="button"
                className="ws-btn ws-btn-ghost"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deletingId !== null}
              >
                取消
              </button>
              <button
                type="button"
                className="ws-btn ws-btn-danger-solid"
                onClick={() => handleConfirmDelete(confirmDeleteEmp.id)}
                disabled={deletingId !== null}
              >
                {deletingId !== null ? '删除中…' : '确认删除'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
