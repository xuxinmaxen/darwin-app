/**
 * 工作台 (V1)
 *
 * 真实 DB 驱动:Server Component 直接调 listProjects(),渲染项目网格 +
 * Client Component 表单创建新项目。
 */

import Link from 'next/link';
import { describeClaudeConfig } from '@/lib/claude';
import { listProjects } from '@/lib/projects';
import type { Project } from '@/lib/types';
import NewProjectForm from '@/components/NewProjectForm';
import ProjectCard from '@/components/ProjectCard';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

async function safeListProjects(): Promise<{
  projects: Project[];
  error: string | null;
}> {
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    return { projects, error: null };
  } catch (err) {
    return {
      projects: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function Home() {
  const claude = describeClaudeConfig();
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { projects, error: dbError } = supabaseConfigured
    ? await safeListProjects()
    : { projects: [] as Project[], error: null };

  return (
    <main className="min-h-screen bg-[#FAF9F5] text-[#1A1A1C]">
      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* Header */}
        <header className="mb-10 flex items-end justify-between gap-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Darwin · v1
            </div>
            <h1 className="text-4xl font-bold tracking-tight">工作台</h1>
            <p className="mt-2 text-sm text-zinc-500">
              多人意图合成。让团队的判断被 AI 合成为一份共鸣的产物。
            </p>
          </div>
          <Link
            href="/demo.html"
            className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:border-indigo-300 hover:text-indigo-700"
          >
            v0 Mock Demo →
          </Link>
        </header>

        {/* Status strip */}
        <div className="mb-6 flex flex-wrap items-center gap-3 text-[11px]">
          <Pill ok={claude.hasKey} label="Anthropic key" />
          <Pill ok={supabaseConfigured} label="Supabase" />
          <span className="text-zinc-400">•</span>
          <span className="font-mono text-zinc-500">
            {claude.baseURL.replace(/^https?:\/\//, '')}
          </span>
          <span className="text-zinc-400">•</span>
          <span className="font-mono text-zinc-500">
            {claude.modelDefault}
          </span>
        </div>

        {/* Create form */}
        <section className="mb-8">
          <NewProjectForm />
        </section>

        {/* Project grid */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              我的项目{' '}
              <span className="ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                {projects.length}
              </span>
            </h2>
          </div>
          {dbError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
              <strong className="font-semibold">DB error:</strong> {dbError}
            </div>
          )}
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
              {supabaseConfigured
                ? '还没有项目。在上方输入名称,点「创建」开始第一个。'
                : '配置 Supabase 后,这里会显示真实项目列表。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map(p => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-16 flex items-center justify-between border-t border-zinc-200 pt-6 text-[11px] text-zinc-400">
          <span>v1 dev · Server Component + Supabase Postgres</span>
          <Link
            href="/api/health"
            className="font-mono hover:text-zinc-600"
          >
            /api/health
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
        ok
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-amber-50 text-amber-700'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ok ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      />
      {label}
    </span>
  );
}
