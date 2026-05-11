'use client';

/**
 * 工作台 shell — Client Component
 *
 * 持有搜索状态、监听 ⌘K、过滤项目列表。Server 把数据一次性灌进来,
 * shell 只负责前端交互 (搜索 / 新建项目按钮 / sidebar nav)。
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { Project } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import ProjectCard from '@/components/ProjectCard';
import NewProjectButton from '@/components/NewProjectButton';
import UserMenu from '@/components/UserMenu';

type Summary = { count: number; preview?: string };

export type CurrentUserMini = {
  id: string;
  name: string;
  role: string;
  cls: string;
  short: string;
};

export default function WorkspaceShell({
  projects,
  summaries,
  collaborators,
  employees,
  supabaseConfigured,
  claudeReady,
  claudeModel,
  dbError,
  memoryCount,
  employeesCount,
  currentUser,
}: {
  projects: Project[];
  summaries: Record<string, Summary>;
  collaborators: Record<string, Employee[]>;
  employees: Employee[];
  supabaseConfigured: boolean;
  claudeReady: boolean;
  claudeModel: string;
  dbError: string | null;
  memoryCount?: number;
  employeesCount?: number;
  currentUser?: CurrentUserMini;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p => {
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.background?.toLowerCase().includes(q)) return true;
      const preview = summaries[p.id]?.preview?.toLowerCase();
      if (preview?.includes(q)) return true;
      return false;
    });
  }, [projects, summaries, query]);

  return (
    <div className="view-workspace">
      <header className="ws-topbar">
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="brand-logo" aria-hidden />
          <span className="brand-text">
            <span className="brand-name">Darwin</span>
            <span className="brand-tagline">组织的每一次共识，即是每一次进化。</span>
          </span>
        </Link>
        <div className="ws-topbar-spacer" />
        <UserMenu user={currentUser} />
      </header>

      <div className="ws-body">
        <Sidebar
          active="projects"
          projectsCount={projects.length}
          memoryCount={memoryCount}
          employeesCount={employeesCount}
        />

        <main className="ws-content">
          <section className="ws-section">
            <div className="ws-hero">
              <div className="ws-hero-eyebrow">
                <span className="dot" />
                项目管理
              </div>
              <h1 className="ws-title">把团队的意图，合成为一份产物</h1>
              <p className="ws-sub">
                每个项目以 Intent Layer 协作。多人输入、AI 合成、单一收敛。同一份意图可以输出落地页、PPT、文档或设计稿。
              </p>
            </div>

            <div className="ws-toolbar">
              <div className="ws-section-title">
                {query ? '搜索结果' : '最近项目'}
                <span className="count">{filtered.length}</span>
                {query && (
                  <button
                    type="button"
                    className="ws-link-btn"
                    onClick={() => setQuery('')}
                  >
                    清除
                  </button>
                )}
              </div>

              <div className="ws-search-bar ws-search-inline">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="6" cy="6" r="4" />
                  <path d="M9 9l3 3" />
                </svg>
                <input
                  ref={inputRef}
                  value={query}
                  placeholder="搜项目名 / 背景 / Intent…"
                  onChange={e => setQuery(e.target.value)}
                />
                <span className="kbd">⌘K</span>
              </div>

              <div className="ws-toolbar-actions">
                <span
                  className="status-pill ok"
                  title="SQLite 本地数据库 (darwin.db)"
                >
                  <span className="dot" />
                  SQLite
                </span>
                <span
                  className={`status-pill ${claudeReady ? 'ok' : 'warn'}`}
                  title={
                    claudeReady
                      ? `Claude 模型 ${claudeModel} 可用`
                      : 'Claude key 待解锁,Intent 抽取/合成功能离线'
                  }
                >
                  <span className="dot" />
                  {claudeReady ? `Claude · ${claudeModel}` : 'Claude 待解锁'}
                </span>
                <NewProjectButton employees={employees} />
              </div>
            </div>

            {dbError && (
              <div className="error-banner">
                <strong>DB error:</strong> {dbError}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="proj-empty">
                {query ? (
                  <>
                    <strong>没有找到「{query}」相关的项目</strong>
                    换个关键词试试，或者点右上角「新建项目」从一句话开始。
                  </>
                ) : (
                  <>
                    <strong>还没有项目</strong>
                    点右上角「新建项目」，从一句话开始。
                  </>
                )}
              </div>
            ) : (
              <div className="ws-projects">
                {filtered.map(p => {
                  const summary = summaries[p.id] ?? { count: 0 };
                  return (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      intentCount={summary.count}
                      preview={summary.preview}
                      collaborators={collaborators[p.id] ?? []}
                    />
                  );
                })}
              </div>
            )}

            <div className="ws-foot">
              <span>v1 · Server Component + Supabase Postgres</span>
              <Link href="/api/health" className="is-mono">
                /api/health
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/* Sidebar inlined here so it stays inside the client subtree.
 * Active section = projects | memory | employees. */
export function Sidebar({
  active,
  projectsCount,
  memoryCount,
  employeesCount,
}: {
  active: 'projects' | 'memory' | 'employees';
  projectsCount: number;
  memoryCount?: number;
  employeesCount?: number;
}) {
  return (
    <aside className="ws-sidebar">
      <nav className="ws-nav">
        <div className="ws-nav-section">工作空间</div>

        <Link href="/" className={`nav-item${active === 'projects' ? ' active' : ''}`}>
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M2 4a1 1 0 0 1 1-1h3l1 1.5h4a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
          </svg>
          项目管理
          <span className="nav-count">{projectsCount}</span>
        </Link>

        <Link href="/memory" className={`nav-item${active === 'memory' ? ' active' : ''}`}>
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M3 7a4 4 0 1 1 8 0 4 4 0 1 1-8 0z" />
            <path d="M5.5 7l1.2 1.2L9 6" />
            <circle cx="11.5" cy="2.5" r=".8" fill="currentColor" />
            <circle cx="2.5" cy="11.5" r=".8" fill="currentColor" />
          </svg>
          团队记忆
          {memoryCount === undefined ? (
            <span className="soon">V2</span>
          ) : (
            <span className="nav-count">{memoryCount}</span>
          )}
        </Link>

        <Link href="/employees" className={`nav-item${active === 'employees' ? ' active' : ''}`}>
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="5" cy="5" r="2.2" />
            <path d="M2 12c.4-1.8 1.7-3 3-3s2.6 1.2 3 3" />
            <circle cx="10" cy="5.5" r="1.8" />
            <path d="M12.5 11c-.3-1.4-1.2-2.4-2.5-2.4" />
          </svg>
          员工管理
          {employeesCount === undefined ? (
            <span className="soon">V2</span>
          ) : (
            <span className="nav-count">{employeesCount}</span>
          )}
        </Link>
      </nav>

      <div className="ws-sidebar-foot">
        <div>
          Darwin · v1 dev
          <br />
          <Link href="/api/health">/api/health</Link>
          {' · '}
          <Link href="/demo.html">v0 demo</Link>
        </div>
      </div>
    </aside>
  );
}
