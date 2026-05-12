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
import ThemeToggle from '@/components/ThemeToggle';

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
  dbError,
  memoryCount,
  employeesCount,
  currentUser,
}: {
  projects: Project[];
  summaries: Record<string, Summary>;
  collaborators: Record<string, Employee[]>;
  employees: Employee[];
  dbError: string | null;
  memoryCount?: number;
  employeesCount?: number;
  currentUser?: CurrentUserMini;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
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
    return projects.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      return true;
    });
  }, [projects, query, typeFilter, statusFilter]);

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
        <ThemeToggle />
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
              <p className="ws-sub">
                每个项目以 Intent Layer 协作，多人输入、AI 合成、单一收敛。
              </p>
            </div>

            {/* 工具栏:左边标题+筛选,右边搜索+新建 — 始终同一行靠右 */}
            <div className="ws-filters">
              {/* 左侧:标题 + 筛选下拉 */}
              <div className="ws-filters-left">
                <div className="ws-section-title">
                  项目
                  <span className="count">{filtered.length}</span>
                </div>
                <div className="ws-filter-group">
                  <select
                    className="ws-filter-select"
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value)}
                    aria-label="项目类型筛选"
                  >
                    <option value="all">产物类型 · 全部</option>
                    <option value="html">落地页</option>
                    <option value="ppt">PPT</option>
                    <option value="doc">文档</option>
                    <option value="design">设计稿</option>
                  </select>
                  <select
                    className="ws-filter-select"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    aria-label="项目状态筛选"
                  >
                    <option value="all">项目状态 · 全部</option>
                    <option value="draft">草稿</option>
                    <option value="collaborating">协作中</option>
                    <option value="tension">有分歧</option>
                    <option value="converged">已收敛</option>
                    <option value="published">已发布</option>
                  </select>
                </div>
              </div>

              {/* 右侧:搜索框 + 新建按钮 — 永远在同一行最右边 */}
              <div className="ws-filters-right">
                <div className="ws-search-bar ws-search-inline">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <circle cx="6" cy="6" r="4" />
                    <path d="M9 9l3 3" />
                  </svg>
                  <input
                    ref={inputRef}
                    value={query}
                    placeholder="搜索项目"
                    onChange={e => setQuery(e.target.value)}
                  />
                  {query && (
                    <button type="button" className="ws-search-clear" onClick={() => setQuery('')} aria-label="清除">×</button>
                  )}
                  <span className="kbd">⌘K</span>
                </div>
                <NewProjectButton employees={employees} currentUserId={currentUser?.id} />
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
                    换个关键词试试，或者新建一个项目。
                  </>
                ) : (
                  <>
                    <strong>还没有项目</strong>
                    点「新建项目」，从一句话开始。
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
              <span>Darwin v1 · 多人意图合成</span>
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
        <div>Darwin · v1</div>
      </div>
    </aside>
  );
}
