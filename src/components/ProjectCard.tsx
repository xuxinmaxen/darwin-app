/**
 * 项目卡片 — Server Component，链接到 /projects/[id]。
 * 视觉与 public/demo.html 中的 .proj 卡片一致。
 */

import Link from 'next/link';
import type { Project } from '@/lib/types';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL } from '@/lib/type-meta';

function formatRelativeTime(iso: string) {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((now - t) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

export default function ProjectCard({
  project,
  intentCount,
  preview,
}: {
  project: Project;
  intentCount: number;
  preview?: string;
}) {
  const previewText =
    preview?.trim() ||
    project.background?.trim() ||
    '还没有 Intent。打开项目，开始第一句表达。';

  return (
    <Link
      href={`/projects/${project.id}`}
      className={`proj${project.status === 'collaborating' || project.status === 'tension' ? ' featured' : ''}`}
    >
      <div className="proj-head">
        <span className="proj-type">
          <TypeIcon type={project.type} />
          <span>{TYPE_LABEL[project.type]}</span>
        </span>
        <span className={`proj-status ${project.status}`}>
          <span className="dot" />
          {STATUS_LABEL[project.status]}
        </span>
      </div>

      <h3 className="proj-card-name">{project.name}</h3>

      <p className="proj-preview">{previewText}</p>

      <div className="proj-foot">
        <span className="proj-collab">
          <span className="avatar xu" title="徐鑫">徐</span>
        </span>
        <span className="proj-meta">
          <strong>{intentCount}</strong>条 Intent
          <span className="proj-meta-sep" />
          {formatRelativeTime(project.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

