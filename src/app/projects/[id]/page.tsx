/**
 * 项目详情页 (V1)
 *
 * Server Component:从 DB 拉项目元数据 + Intent 列表,渲染:
 * - 顶部:项目元信息 + 返回链接
 * - Intent 看板:列表显示 + 内联输入框
 * - 产物画布:V1 占位（等 Claude 接通后渲染合成结果）
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getProject } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import IntentForm from '@/components/IntentForm';
import IntentCard from '@/components/IntentCard';
import type { Project } from '@/lib/types';

const TYPE_LABEL: Record<Project['type'], string> = {
  html: '落地页',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

type Params = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const intents = await listIntentsByProject(id);

  return (
    <main className="min-h-screen bg-[#FAF9F5] text-[#1A1A1C]">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-900"
          >
            <span aria-hidden>←</span>
            返回工作台
          </Link>
          <Link
            href="/demo.html"
            className="text-xs text-zinc-400 hover:text-indigo-600"
          >
            v0 Demo
          </Link>
        </div>

        {/* Project header */}
        <header className="mb-8 border-b border-zinc-200 pb-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
              {TYPE_LABEL[project.type]}
            </span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              {project.status}
            </span>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {project.conflictMode === 'discuss'
                ? '员工讨论共识'
                : 'AI 最优解判断'}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          {project.background && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
              {project.background}
            </p>
          )}
        </header>

        {/* Two-column layout: intent board + product canvas */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.4fr]">
          {/* Left: Intent board */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Intent 看板
              </h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                {intents.length}
              </span>
            </div>
            <div className="mb-4">
              <IntentForm projectId={project.id} />
            </div>
            {intents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white/50 p-8 text-center text-xs text-zinc-500">
                还没有 Intent。<br />
                大家各抒己见,AI 会自动抽取为可合并的结构化 Intent。
              </div>
            ) : (
              <div className="space-y-3">
                {intents.map(i => (
                  <IntentCard key={i.id} intent={i} />
                ))}
              </div>
            )}
          </section>

          {/* Right: Product canvas (V1 placeholder) */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                产物画布
              </h2>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                等待 Claude
              </span>
            </div>
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M12 3v18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-zinc-800">
                产物渲染待 Hermes Key 解锁
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
                Intent 已经在持久化。等 Claude API 接通后,这块会从 Intent[]
                合成真实落地页 / PPT / 文档 / 设计稿 — 同一组意图通过 Adapter
                输出多种产物形态。
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-16 flex items-center justify-between border-t border-zinc-200 pt-6 text-[11px] text-zinc-400">
          <span>项目 ID: <code className="font-mono">{project.id}</code></span>
          <Link href={`/api/projects/${project.id}/intents`} className="font-mono hover:text-zinc-600">
            /api/projects/{project.id.slice(0, 8)}…/intents
          </Link>
        </footer>
      </div>
    </main>
  );
}
