/**
 * 项目卡片 — Server Component，链接到 /projects/[id]。
 * 视觉与 public/demo.html 中的 .proj 卡片一致。
 */

import Link from 'next/link';
import type { Project } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL } from '@/lib/type-meta';
import ProjectActionsMenu from '@/components/ProjectActionsMenu';

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

const MAX_AVATARS_VISIBLE = 4;

export default function ProjectCard({
  project,
  intentCount,
  preview,
  collaborators,
}: {
  project: Project;
  intentCount: number;
  preview?: string;
  collaborators: Employee[];
}) {
  // 卡片摘要: 项目背景优先(让人一眼知道这是做什么的); 没背景才降级到 Intent 内容
  const backgroundText = project.background?.trim();
  const previewText =
    backgroundText ||
    preview?.trim() ||
    '还没有背景描述。打开项目，开始第一句表达。';

  return (
    <div
      className={`proj${project.status === 'collaborating' || project.status === 'tension' ? ' featured' : ''}`}
    >
      <Link href={`/projects/${project.id}`} className="proj-link">
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
            {collaborators.slice(0, MAX_AVATARS_VISIBLE).map(e => (
              <span
                key={e.id}
                className={`avatar ${e.cls}${e.kind === 'agent' ? ' agent' : ''}`}
                title={`${e.name}${e.role ? ` · ${e.role}` : ''}${e.kind === 'agent' ? '（Agent）' : ''}`}
              >
                {e.short}
              </span>
            ))}
            {collaborators.length > MAX_AVATARS_VISIBLE && (
              <span
                className="avatar avatar-more"
                title={`还有 ${collaborators.length - MAX_AVATARS_VISIBLE} 位协作者`}
              >
                +{collaborators.length - MAX_AVATARS_VISIBLE}
              </span>
            )}
          </span>
          <span className="proj-meta" suppressHydrationWarning>
            <strong>{intentCount}</strong>条 Intent
            <span className="proj-meta-sep" />
            {formatRelativeTime(project.updatedAt)}
          </span>
        </div>
      </Link>
      <ProjectActionsMenu project={project} />
    </div>
  );
}

