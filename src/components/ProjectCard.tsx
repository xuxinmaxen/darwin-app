/**
 * Single project card — Server Component (no interactivity needed for V1).
 */

import type { Project } from '@/lib/types';

const TYPE_LABEL: Record<Project['type'], string> = {
  html: '落地页',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

const STATUS_LABEL: Record<Project['status'], string> = {
  draft: '草稿',
  collaborating: '协作中',
  tension: '有分歧',
  converged: '已收敛',
  published: '已发布',
};

const STATUS_TONE: Record<Project['status'], string> = {
  draft: 'bg-zinc-100 text-zinc-600',
  collaborating: 'bg-indigo-50 text-indigo-700',
  tension: 'bg-amber-50 text-amber-700',
  converged: 'bg-emerald-50 text-emerald-700',
  published: 'bg-violet-50 text-violet-700',
};

export default function ProjectCard({ project }: { project: Project }) {
  const updated = new Date(project.updatedAt);
  return (
    <div className="group flex h-full flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
          {TYPE_LABEL[project.type]}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
            STATUS_TONE[project.status]
          }`}
        >
          {STATUS_LABEL[project.status]}
        </span>
      </div>
      <h3 className="text-base font-semibold leading-tight tracking-tight">
        {project.name}
      </h3>
      {project.background && (
        <p className="line-clamp-2 text-xs text-zinc-500">
          {project.background}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
        <span>
          {project.conflictMode === 'discuss'
            ? '员工讨论共识'
            : 'AI 最优解判断'}
        </span>
        <time dateTime={project.updatedAt}>
          {updated.toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
    </div>
  );
}
