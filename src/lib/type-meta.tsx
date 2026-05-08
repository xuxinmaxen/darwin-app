import type { Project } from '@/lib/types';

type ProjectType = Project['type'];

export const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function TypeIcon({ type }: { type: ProjectType }) {
  switch (type) {
    case 'html':
      return (
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
          <path d="M1.5 5.5h11" />
        </svg>
      );
    case 'ppt':
      return (
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <rect x="2" y="2" width="10" height="7" rx="1" />
          <path d="M5 11.5h4M7 9.5v2" />
        </svg>
      );
    case 'doc':
      return (
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <path d="M3 1.5h6l3 3v8a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5z" />
          <path d="M9 1.5v3h3M5 7h4M5 9.5h4M5 5h2" />
        </svg>
      );
    case 'design':
      return (
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <circle cx="4.5" cy="4.5" r="2.5" />
          <circle cx="9.5" cy="4.5" r="2.5" />
          <circle cx="9.5" cy="9.5" r="2.5" />
          <circle cx="4.5" cy="9.5" r="2.5" />
        </svg>
      );
  }
}

export const STATUS_LABEL: Record<Project['status'], string> = {
  draft: '草稿',
  collaborating: '协作中',
  tension: '有分歧',
  converged: '已收敛',
  published: '已发布',
};
