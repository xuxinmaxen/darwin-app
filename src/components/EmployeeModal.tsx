'use client';

/**
 * 员工新建/编辑 模态。
 *
 * - 新建: kind picker 可点 (human / agent),根据 kind 显示 email 或 persona
 * - 编辑: kind 不可改 (kind 决定身份, 改了语义不对)
 *
 * 受控形态: 父组件传 mode/initial,本组件提交后回调 onSaved(employee)。
 */

import { useEffect, useState } from 'react';
import type { Employee, EmployeeKind } from '@/lib/employees';

const ROLE_OPTIONS = ['PM', 'UI', 'RD', '运营', '增长', '文案', 'CEO'];
const ROLE_HINT: Record<string, string> = {
  PM: '产品经理',
  UI: '设计师',
  RD: '工程师',
};

type Props = {
  open: boolean;
  initial: Employee | null; // null = 新建模式
  onClose: () => void;
  onSaved: (employee: Employee) => void;
};

export default function EmployeeModal({
  open,
  initial,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!initial;
  const [kind, setKind] = useState<EmployeeKind>(initial?.kind ?? 'human');
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? 'PM');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [persona, setPersona] = useState(initial?.persona ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 每次打开时重置表单
  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? 'human');
    setName(initial?.name ?? '');
    setRole(initial?.role ?? 'PM');
    setEmail(initial?.email ?? '');
    setPersona(initial?.persona ?? '');
    setError(null);
    setSaving(false);
  }, [open, initial]);

  // ESC 关
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请填写员工名称');
      return;
    }
    if (kind === 'agent' && !persona.trim()) {
      setError('Agent 必须填写人设 — 它会按这段话决定怎么贡献 Intent');
      return;
    }

    setSaving(true);
    try {
      const url = isEdit
        ? `/api/employees/${initial!.id}`
        : '/api/employees';
      const method = isEdit ? 'PATCH' : 'POST';
      const body = isEdit
        ? {
            name: trimmedName,
            role,
            email: kind === 'human' ? email.trim() || null : undefined,
            persona: kind === 'agent' ? persona.trim() || null : undefined,
          }
        : {
            kind,
            name: trimmedName,
            role,
            email: kind === 'human' ? email.trim() || null : null,
            persona: kind === 'agent' ? persona.trim() || null : null,
          };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `请求失败 (${res.status})`);
        return;
      }
      onSaved(json.employee);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <form
        className="modal-panel emp-modal"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="modal-head">
          <h2 className="modal-title">{isEdit ? '编辑员工' : '新增员工'}</h2>
          <p className="modal-sub">
            {isEdit
              ? '改名字、角色、邮箱或人设。kind 不可变,因为它决定了 Intent 怎么生成。'
              : '真实员工填邮箱; Agent 填人设, 决定它在协作里的视角和风格。'}
          </p>
        </header>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">员工类型</label>
            <div className="kind-grid">
              <button
                type="button"
                className={`kind-opt ${kind === 'human' ? 'active' : ''}`}
                onClick={() => !isEdit && setKind('human')}
                disabled={isEdit}
              >
                <span className="kind-opt-icon human">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <circle cx="8" cy="5.5" r="2.5" />
                    <path d="M3 14c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
                  </svg>
                </span>
                <span className="kind-opt-body">
                  <span className="kind-opt-title">真实员工</span>
                  <span className="kind-opt-sub">人,有邮箱</span>
                </span>
              </button>
              <button
                type="button"
                className={`kind-opt ${kind === 'agent' ? 'active' : ''}`}
                onClick={() => !isEdit && setKind('agent')}
                disabled={isEdit}
              >
                <span className="kind-opt-icon agent">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="2.5" y="4.5" width="11" height="8" rx="1.5" />
                    <circle cx="6" cy="8.5" r=".8" fill="currentColor" />
                    <circle cx="10" cy="8.5" r=".8" fill="currentColor" />
                    <path d="M8 4.5V2.5M6.5 2.5h3" />
                  </svg>
                </span>
                <span className="kind-opt-body">
                  <span className="kind-opt-title">Agent 员工</span>
                  <span className="kind-opt-sub">AI,有人设</span>
                </span>
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="emp-name">
              员工名称
            </label>
            <input
              id="emp-name"
              className="field-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如:陈飞 / Atlas"
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="emp-role">
              员工角色
            </label>
            <select
              id="emp-role"
              className="field-select"
              value={role}
              onChange={e => setRole(e.target.value)}
              disabled={saving}
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r} value={r}>
                  {r}
                  {ROLE_HINT[r] ? ` · ${ROLE_HINT[r]}` : ''}
                </option>
              ))}
            </select>
          </div>

          {kind === 'human' && (
            <div className="field">
              <label className="field-label" htmlFor="emp-email">
                邮箱 <span className="field-hint">选填</span>
              </label>
              <input
                id="emp-email"
                className="field-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@deeplumen.com"
                disabled={saving}
              />
            </div>
          )}

          {kind === 'agent' && (
            <div className="field">
              <label className="field-label" htmlFor="emp-persona">
                人设 <span className="field-hint">— 描述这个 Agent 的视角、风格、关注点</span>
              </label>
              <textarea
                id="emp-persona"
                className="field-input field-textarea"
                value={persona}
                onChange={e => setPersona(e.target.value)}
                placeholder="例如:资深产品经理 Agent,擅长第一性原理思考;会主动指出方案脆弱点;偏好简洁直接的反馈风格。"
                disabled={saving}
                rows={4}
              />
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
            type="submit"
            className="ws-btn ws-btn-accent"
            disabled={saving}
          >
            {saving ? '保存中…' : isEdit ? '保存修改' : '添加员工 →'}
          </button>
        </footer>
      </form>
    </div>
  );
}
