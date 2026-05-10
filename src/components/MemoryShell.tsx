'use client';

/**
 * 团队记忆页 — Client Component
 *
 * 三个区块依次渲染:
 *   1. 团队共识 (prefs) — 网格 + 新增/导出工具栏
 *   2. Agent 学习状态 — 卡片
 *   3. 决策时间线 — 时间轴
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/WorkspaceShell';
import type {
  TeamPref,
  TeamPrefIconKey,
  AgentLearning,
  MemoryEvent,
} from '@/lib/types';

const ICON_MAP: Record<TeamPrefIconKey, string> = {
  pen: '✎',
  eye: '◉',
  graph: '⤴',
  audience: '◎',
  flow: '↺',
  note: '✱',
};

const ICON_LABEL: Record<TeamPrefIconKey, string> = {
  pen: '文案风格',
  eye: '视觉风格',
  graph: '商业策略',
  audience: '目标受众',
  flow: '协作风格',
  note: '其他',
};

const KIND_COLOR: Record<MemoryEvent['kind'], string> = {
  consensus: '#4F46E5',     // 紫
  'agent-event': '#06B6D4', // 青
  onboarding: '#94A3B8',    // 灰
};

const KIND_LABEL: Record<MemoryEvent['kind'], string> = {
  consensus: '共识',
  'agent-event': 'Agent 互动',
  onboarding: '入职',
};

export default function MemoryShell({
  initialPrefs,
  agents,
  timeline,
  projectsCount,
  memoryCount,
  employeesCount,
}: {
  initialPrefs: TeamPref[];
  agents: AgentLearning[];
  timeline: MemoryEvent[];
  projectsCount: number;
  memoryCount?: number;
  employeesCount?: number;
}) {
  const [prefs, setPrefs] = useState<TeamPref[]>(initialPrefs);
  const [editing, setEditing] = useState<TeamPref | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Agent 学习画像 tag — 服务端渲染过来的可能是 stale 或 null;
  // 在 client 上对每个"intent 数量 > 上次抽取数量"或"tags===null"的 agent
  // fire-and-forget 触发一次 recompute, 拿到结果后局部 patch。
  // 只对至少有 2 条 intent 的 agent 触发: <2 条根本不会出 tag, 不浪费 LLM。
  const [agentsState, setAgentsState] = useState<AgentLearning[]>(agents);
  useEffect(() => {
    const stale = agentsState.filter(
      a =>
        a.intentsContributed >= 2 &&
        (a.tags === null || a.intentsContributed !== a.tagsIntentCount)
    );
    if (stale.length === 0) return;
    let cancelled = false;
    for (const a of stale) {
      fetch(`/api/employees/${a.agentId}/recompute-tags`, { method: 'POST' })
        .then(r => r.json())
        .then(json => {
          if (cancelled || !json.ok) return;
          setAgentsState(prev =>
            prev.map(x =>
              x.agentId === a.agentId
                ? { ...x, tags: json.tags, tagsIntentCount: json.intentCount }
                : x
            )
          );
        })
        .catch(() => { /* 静默 */ });
    }
    return () => { cancelled = true; };
    // 故意只在挂载 / agentsState 长度变化时跑, 避免 patch 自己触发死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsState.length]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(p: TeamPref) {
    setEditing(p);
    setModalOpen(true);
  }
  function handleSaved(saved: TeamPref) {
    setPrefs(prev => {
      const idx = prev.findIndex(p => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setModalOpen(false);
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/team/prefs/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || '删除失败');
        return;
      }
      setPrefs(prev => prev.filter(p => p.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const confirmDeletePref = confirmDeleteId
    ? prefs.find(p => p.id === confirmDeleteId)
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
        <Sidebar
          active="memory"
          projectsCount={projectsCount}
          memoryCount={memoryCount}
          employeesCount={employeesCount}
        />

        <main className="ws-content">
          <section className="ws-section">
            <div className="ws-hero">
              <div className="ws-hero-eyebrow">
                <span className="dot" />
                团队记忆
              </div>
              <h1 className="ws-title">组织级 AI 资产</h1>
              <p className="ws-sub">
                每次冲突的解决、每个决策的取舍,都会自动沉淀为团队共识。
                新加入的 Agent 会读取这份记忆,第一天就懂团队脾气。
              </p>
            </div>

            {/* ── A. 团队共识 ── */}
            <div className="ws-toolbar">
              <div className="ws-section-title">
                团队共识
                <span className="count">{prefs.length}</span>
              </div>
              <div className="ws-toolbar-actions">
                <button
                  type="button"
                  className="ws-btn ws-btn-ghost"
                  onClick={openNew}
                  title="新增共识"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                    <path d="M6 2v8M2 6h8" />
                  </svg>
                  新增共识
                </button>
                <a
                  className="ws-btn ws-btn-primary"
                  href="/api/team/prefs/export"
                  title="导出为 Markdown,可作为 Claude / GPT / Cursor 全局规范"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2v6M3.5 5.5L6 8l2.5-2.5M2 10h8" />
                  </svg>
                  导出 MD
                </a>
              </div>
            </div>

            {error && (
              <div className="emp-list-error">
                ⚠️ {error}
                <button type="button" onClick={() => setError(null)}>×</button>
              </div>
            )}

            {prefs.length === 0 ? (
              <div className="proj-empty">
                <strong>还没有团队共识</strong>
                每次冲突仲裁后,团队的判断可以沉淀到这里。
                也可以现在就 <button type="button" className="ws-link-btn" onClick={openNew}>手动新增第一条</button>。
              </div>
            ) : (
              <div className="memory-grid">
                {prefs.map(p => (
                  <div key={p.id} className="mem-card">
                    <div className="card-actions">
                      <button
                        type="button"
                        className="card-action-btn"
                        onClick={() => openEdit(p)}
                        title="编辑"
                      >
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <path d="M2 10v-2l6-6 2 2-6 6H2zM7 3l2 2" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="card-action-btn danger"
                        onClick={() => setConfirmDeleteId(p.id)}
                        title="删除"
                      >
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <path d="M3 4h6v6.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5V4zM2 4h8M5 2h2v2H5z" />
                        </svg>
                      </button>
                    </div>
                    <div className="mem-card-icon" aria-hidden>{ICON_MAP[p.iconKey]}</div>
                    <div className="mem-card-cat">{p.category}</div>
                    <div
                      className="mem-card-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownLite(p.body) }}
                    />
                    <div className="mem-card-source">
                      <span className={`avatar ${p.sourceCls}`}>
                        {p.source[0] ?? '?'}
                      </span>
                      <span>{p.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── B. Agent 学习状态 ── */}
            <div className="ws-toolbar" style={{ marginTop: 32 }}>
              <div className="ws-section-title">
                Agent 学习状态
                <span className="count">{agents.length}</span>
              </div>
            </div>

            {agentsState.length === 0 ? (
              <div className="proj-empty">
                <strong>团队还没有 Agent</strong>
                去 <Link href="/employees">员工管理</Link> 新增 Agent 或为真人配置数字分身。
              </div>
            ) : (
              <div className="memory-grid">
                {agentsState.map(a => (
                  <div key={a.agentId} className="mem-card agent-card">
                    <div className="agent-meta">
                      <span className={`avatar ${a.agentCls} agent`}>{a.agentShort}</span>
                      <div>
                        <div className="agent-info-name">
                          {a.agentName}
                          {a.isDigitalTwin && <span className="agent-twin-tag">数字分身</span>}
                        </div>
                        <div className="agent-info-role">{a.agentRole}</div>
                      </div>
                    </div>
                    {a.intentsContributed < 2 ? (
                      <div className="agent-tags agent-tags-empty">
                        贡献 ≥2 条 Intent 后开始学习
                      </div>
                    ) : a.tags === null ? (
                      <div className="agent-tags agent-tags-loading">
                        <span className="agent-tag-skel" />
                        <span className="agent-tag-skel" />
                        <span className="agent-tag-loading-text">学习画像计算中…</span>
                      </div>
                    ) : a.tags.length > 0 ? (
                      <div className="agent-tags">
                        {a.tags.map(tag => (
                          <span key={tag} className="agent-tag">{tag}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="agent-tags agent-tags-empty">
                        暂未抽出稳定取向
                      </div>
                    )}
                    <div className="agent-stats">
                      <div className="agent-stat">
                        <span className="agent-stat-num">{a.projectsRead}</span>
                        参与项目
                      </div>
                      <div className="agent-stat">
                        <span className="agent-stat-num">{a.intentsContributed}</span>
                        贡献 Intent
                      </div>
                      <div className="agent-stat">
                        <span className="agent-stat-num">{a.tensionsTouched}</span>
                        卷入冲突
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── C. 决策时间线 ── */}
            <div className="ws-toolbar" style={{ marginTop: 32 }}>
              <div className="ws-section-title">最近决策时间线</div>
            </div>

            {timeline.length === 0 ? (
              <div className="proj-empty">
                <strong>还没有决策事件</strong>
                团队完成一次冲突仲裁、新增 Agent 后,事件会出现在这里。
              </div>
            ) : (
              <div className="memory-timeline">
                {timeline.map(ev => (
                  <div key={ev.id} className={`mem-event mem-event-${ev.kind}`}>
                    <span
                      className="mem-event-dot"
                      style={{ background: KIND_COLOR[ev.kind] }}
                    />
                    <div className="mem-event-body">
                      <div className="mem-event-head">
                        <span
                          className="mem-event-kind"
                          style={{ color: KIND_COLOR[ev.kind] }}
                        >
                          {KIND_LABEL[ev.kind]}
                        </span>
                        <span className="mem-event-date">{relTime(ev.date)}</span>
                      </div>
                      <div
                        className="mem-event-text"
                        dangerouslySetInnerHTML={{ __html: renderMarkdownLite(ev.body) }}
                      />
                      <div className="mem-event-meta">{ev.meta}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {modalOpen && (
        <PrefModal
          initial={editing}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {confirmDeletePref && (
        <div
          className="modal-backdrop"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="modal-panel"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
          >
            <header className="modal-head">
              <h2 className="modal-title">
                删除共识「{confirmDeletePref.category}」?
              </h2>
              <p className="modal-sub">
                团队共识被永久移除。下次导出 Markdown 时不再包含。
              </p>
            </header>
            <footer className="modal-foot">
              <button
                type="button"
                className="ws-btn ws-btn-ghost"
                onClick={() => setConfirmDeleteId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="ws-btn ws-btn-danger-solid"
                onClick={() => handleDelete(confirmDeletePref.id)}
              >
                确认删除
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pref 编辑模态 ─────────────────────────────────────────

function PrefModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: TeamPref | null;
  onClose: () => void;
  onSaved: (pref: TeamPref) => void;
}) {
  const isEdit = !!initial;
  const [iconKey, setIconKey] = useState<TeamPrefIconKey>(initial?.iconKey ?? 'note');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [source, setSource] = useState(initial?.source ?? '徐鑫');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!category.trim()) {
      setError('请填写类别');
      return;
    }
    if (!body.trim()) {
      setError('请填写共识描述');
      return;
    }
    setSaving(true);
    try {
      const url = isEdit ? `/api/team/prefs/${initial!.id}` : '/api/team/prefs';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iconKey,
          category: category.trim(),
          body: body.trim(),
          source: source.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || '保存失败');
        return;
      }
      onSaved(json.pref);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <form
        className="modal-panel"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="modal-head">
          <h2 className="modal-title">{isEdit ? '编辑共识' : '新增共识'}</h2>
          <p className="modal-sub">
            团队级偏好,跨项目沉淀。导出 Markdown 后可作为 AI 工具的全局规范。
          </p>
        </header>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">图标分类</label>
            <div className="icon-picker">
              {(Object.keys(ICON_MAP) as TeamPrefIconKey[]).map(k => (
                <button
                  key={k}
                  type="button"
                  className={`icon-opt${iconKey === k ? ' active' : ''}`}
                  onClick={() => setIconKey(k)}
                  title={ICON_LABEL[k]}
                >
                  <span className="icon-opt-glyph">{ICON_MAP[k]}</span>
                  <span className="icon-opt-label">{ICON_LABEL[k]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pref-cat">类别</label>
            <input
              id="pref-cat"
              className="field-input"
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="例如: 文案风格 / 视觉风格"
              disabled={saving}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pref-body">
              共识描述 <span className="field-hint">— 支持 **加粗** 标记</span>
            </label>
            <textarea
              id="pref-body"
              className="field-input field-textarea"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="例如: 团队倾向**简洁直接**,避免抽象的钩子句"
              disabled={saving}
              rows={4}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pref-src">来源</label>
            <input
              id="pref-src"
              className="field-input"
              type="text"
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="例如: 徐鑫 / 团队默认 / hero 冲突 v2"
              disabled={saving}
            />
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
            type="submit"
            className="ws-btn ws-btn-accent"
            disabled={saving}
          >
            {saving ? '保存中…' : isEdit ? '保存修改' : '添加共识'}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

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

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d 前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
