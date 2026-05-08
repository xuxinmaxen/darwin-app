/**
 * 工作台 (V1) — Server Component
 *
 * 视觉对齐 public/demo.html 的 view-workspace（topbar + sidebar + ws-content）。
 * 真实 Supabase 项目 + 每个项目的 Intent 数量摘要。
 */

import Link from 'next/link';
import { describeClaudeConfig } from '@/lib/claude';
import { listProjects } from '@/lib/projects';
import { summarizeIntentsForProjects } from '@/lib/intents';
import type { Project } from '@/lib/types';
import Sidebar from '@/components/Sidebar';
import ProjectCard from '@/components/ProjectCard';
import NewProjectButton from '@/components/NewProjectButton';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

type LoadResult = {
  projects: Project[];
  summaries: Map<string, { count: number; preview?: string }>;
  error: string | null;
};

async function safeLoad(): Promise<LoadResult> {
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    const summaries = await summarizeIntentsForProjects(
      projects.map(p => p.id)
    );
    return { projects, summaries, error: null };
  } catch (err) {
    return {
      projects: [],
      summaries: new Map(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function WorkspacePage() {
  const claude = describeClaudeConfig();
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { projects, summaries, error: dbError } = supabaseConfigured
    ? await safeLoad()
    : {
        projects: [] as Project[],
        summaries: new Map<string, { count: number; preview?: string }>(),
        error: null,
      };

  return (
    <div className="view-workspace">
      <header className="ws-topbar">
        <div className="brand">
          <div className="brand-logo" aria-hidden />
          <span className="brand-name">Darwin</span>
          <span className="brand-sub">多人意图合成</span>
        </div>
        <div className="ws-topbar-spacer" />
        <div className="ws-search-bar">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="6" cy="6" r="4" />
            <path d="M9 9l3 3" />
          </svg>
          <input placeholder="搜索项目…" disabled />
          <span className="kbd">⌘K</span>
        </div>
        <div className="ws-user">
          <div className="avatar xu" title="徐鑫 / 产品">徐</div>
        </div>
      </header>

      <div className="ws-body">
        <Sidebar active="projects" projectsCount={projects.length} />

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
                最近项目
                <span className="count">{projects.length}</span>
              </div>

              <div className="ws-toolbar-actions">
                <span className="status-pill ok" style={{ display: supabaseConfigured ? 'inline-flex' : 'none' }}>
                  <span className="dot" />
                  Supabase 已连接
                </span>
                <span
                  className={`status-pill ${claude.hasKey ? 'ok' : 'warn'}`}
                  title={claude.baseURL}
                >
                  <span className="dot" />
                  {claude.hasKey ? `Claude · ${claude.modelDefault}` : 'Claude 待解锁'}
                </span>
                <NewProjectButton />
              </div>
            </div>

            {dbError && (
              <div className="error-banner">
                <strong>DB error:</strong> {dbError}
              </div>
            )}

            {projects.length === 0 ? (
              <div className="proj-empty">
                <strong>{supabaseConfigured ? '还没有项目' : '请先配置 Supabase'}</strong>
                {supabaseConfigured ? (
                  <>点右上角「新建项目」，从一句话开始。</>
                ) : (
                  <>
                    在 <code>.env.local</code> 配齐 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。
                  </>
                )}
              </div>
            ) : (
              <div className="ws-projects">
                {projects.map(p => {
                  const summary = summaries.get(p.id) ?? { count: 0 };
                  return (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      intentCount={summary.count}
                      preview={summary.preview}
                    />
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 60, fontSize: 11, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
              <span>v1 · Server Component + Supabase Postgres</span>
              <Link href="/api/health" style={{ color: 'inherit', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', textDecoration: 'none' }}>
                /api/health
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
