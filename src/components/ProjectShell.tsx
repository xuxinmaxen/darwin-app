'use client';

/**
 * 项目详情视图 — Client Component
 *
 * V1: 左侧 Intent 看板 (真实数据 + 输入框) + 中间画布 (等 Claude 解锁的占位)。
 * 讨论抽屉是 V2 才上线的能力,V1 直接不渲染,避免按了之后只能看到「即将上线」。
 */

import Link from 'next/link';
import type { Project, Intent } from '@/lib/types';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL } from '@/lib/type-meta';
import IntentCard from '@/components/IntentCard';
import IntentForm from '@/components/IntentForm';
import ProjectActionsMenu from '@/components/ProjectActionsMenu';
import ProjectCanvas from '@/components/ProjectCanvas';
import type { Version } from '@/lib/versions';

export default function ProjectShell({
  project,
  intents,
  claudeReady,
  initialVersion,
}: {
  project: Project;
  intents: Intent[];
  claudeReady: boolean;
  initialVersion: Version | null;
}) {
  return (
    <div className="view-project">
      {/* TOP BAR */}
      <div className="topbar">
        <Link href="/" className="back-link" title="返回工作台">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M7.5 2.5L4 6l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          工作台
        </Link>
        <div className="vsep" />
        <Link
          href="/"
          className="brand"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="brand-logo" aria-hidden />
          <span className="brand-name">Darwin</span>
        </Link>
        <div className="vsep" />
        <div className="project-info">
          <svg className="proj-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M2 4.5l5-2.5 5 2.5v5L7 12 2 9.5v-5z" />
            <path d="M2 4.5L7 7l5-2.5M7 7v5" />
          </svg>
          <span className="proj-name">{project.name}</span>
          <span className="project-tag">
            <TypeIcon type={project.type} />
            <span>{TYPE_LABEL[project.type]}</span>
          </span>
          <span
            className={`proj-status ${project.status}`}
            style={{ marginLeft: 4 }}
            title={`状态：${STATUS_LABEL[project.status]}`}
          >
            <span className="dot" />
            {STATUS_LABEL[project.status]}
          </span>
        </div>

        <div className="topbar-spacer" />

        <ProjectActionsMenu project={project} />
        <div className="ws-user">
          <div className="avatar xu" title="徐鑫">徐</div>
        </div>
      </div>

      {/* MAIN GRID — V1: 2 cols (board + canvas). V2 加上讨论抽屉 */}
      <div className="main main-v1">
        {/* LEFT: INTENT BOARD */}
        <aside className="board">
          <div className="board-head">
            <div className="board-head-text">
              <span className="board-title">Intent 看板</span>
              <span className="board-sub">大家想要什么</span>
            </div>
            <span className="board-count">{intents.length}</span>
          </div>

          <div className="board-list">
            {intents.length === 0 ? (
              <div className="board-empty">
                <strong>大家各抒己见</strong>
                AI 自动抽取为可合并的 Intent
                <br />
                信息足够时自动开始合成
              </div>
            ) : (
              intents.map(i => <IntentCard key={i.id} intent={i} />)
            )}
          </div>

          <IntentForm projectId={project.id} />
        </aside>

        {/* CENTER: CANVAS */}
        <section className="canvas-wrap">
          <div className="statusbar">
            <span className={`status-icon ${intents.length === 0 ? 'idle' : initialVersion ? 'done' : ''}`} />
            <span className="status-text">
              {intents.length === 0 ? (
                <>等待输入。所有人到齐后，AI 会把意图合成为产物。</>
              ) : initialVersion ? (
                <>
                  已合成 · <strong>{intents.length}</strong> 条 Intent · {TYPE_LABEL[project.type]}
                </>
              ) : (
                <>
                  已收集 <strong>{intents.length}</strong> 条 Intent · 等待合成
                </>
              )}
            </span>
          </div>

          <div className="canvas">
            <ProjectCanvas
              project={project}
              intents={intents}
              initialVersion={initialVersion}
              claudeReady={claudeReady}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
