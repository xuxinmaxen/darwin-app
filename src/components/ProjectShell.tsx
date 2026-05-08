'use client';

/**
 * 项目详情视图 — Client Component
 *
 * 视觉对齐 public/demo.html 的 view-project（topbar + main 三栏）。
 * V1：左侧 Intent 看板（真实数据 + 输入框），中间画布占位（等 Claude 解锁），
 * 右侧讨论抽屉占位（V2 接入）。讨论按钮可开/关抽屉。
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Project, Intent } from '@/lib/types';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL } from '@/lib/type-meta';
import IntentCard from '@/components/IntentCard';
import IntentForm from '@/components/IntentForm';

export default function ProjectShell({
  project,
  intents,
  claudeReady,
}: {
  project: Project;
  intents: Intent[];
  claudeReady: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        <div className="brand">
          <div className="brand-logo" aria-hidden />
          <span className="brand-name">Darwin</span>
        </div>
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

        <div className="ws-user">
          <div className="avatar xu" title="徐鑫">徐</div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className={`main${drawerOpen ? '' : ' drawer-closed'}`}>
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
            <span className={`status-icon ${intents.length === 0 ? 'idle' : ''}`} />
            <span className="status-text">
              {intents.length === 0 ? (
                <>等待输入。所有人到齐后，AI 会把意图合成为产物。</>
              ) : claudeReady ? (
                <>已收集 <strong>{intents.length}</strong> 条 Intent · Claude 抽取已上线</>
              ) : (
                <>已收集 <strong>{intents.length}</strong> 条 Intent · 等 Claude 解锁后开始合成</>
              )}
            </span>
            <button
              type="button"
              className="discuss-toggle"
              onClick={() => setDrawerOpen(v => !v)}
              title="展开 / 收起讨论抽屉"
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 12 4v4.5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2v-2H3.5A1.5 1.5 0 0 1 2 8.5V4z" />
              </svg>
              <span>讨论</span>
            </button>
          </div>

          <div className="canvas">
            <CanvasContent
              project={project}
              intentCount={intents.length}
              claudeReady={claudeReady}
            />
          </div>
        </section>

        {/* RIGHT: DISCUSSION DRAWER */}
        <aside className="thread-pane">
          <div className="thread-head">
            <span className="thread-title">讨论</span>
            <button
              type="button"
              className="thread-close"
              onClick={() => setDrawerOpen(false)}
              aria-label="关闭"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
          <div className="thread-body">
            <div className="thread-empty">
              <strong>讨论区 V2 上线</strong>
              冲突浮现时，这里会出现专题讨论串。Agent 与人在同一个串里发言、收敛。
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CanvasContent({
  project,
  intentCount,
  claudeReady,
}: {
  project: Project;
  intentCount: number;
  claudeReady: boolean;
}) {
  if (intentCount === 0) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty-illu">
          <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M11 3v16M3 11h16M5.5 5.5l11 11M16.5 5.5l-11 11" />
          </svg>
        </div>
        <div>
          <strong>等待 Intent 输入</strong>
          <p>
            大家各自表达想要什么，AI 会抽取为结构化 Intent，再合成为产物。冲突浮现时不阻塞他人贡献。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-empty">
      <div className="canvas-empty-illu">
        <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <circle cx="11" cy="11" r="6" />
          <circle cx="11" cy="11" r="2" fill="currentColor" />
        </svg>
      </div>
      <div>
        <strong>
          {claudeReady
            ? `已收集 ${intentCount} 条 Intent · 准备合成 ${TYPE_LABEL[project.type]}`
            : `已收集 ${intentCount} 条 Intent · 等 Claude 解锁`}
        </strong>
        <p>
          {claudeReady ? (
            <>下一步：把这 {intentCount} 条 Intent 合成为 {TYPE_LABEL[project.type]} 产物。这块即将接入 Claude，按 scope 局部增量重渲染。</>
          ) : (
            <>Intent 已经在持久化。Hermes Key 解锁后，这块会从 Intent[] 合成真实 {TYPE_LABEL[project.type]} — 同一组意图通过 Adapter 输出多种产物形态。</>
          )}
        </p>
        {project.background && (
          <p style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', maxWidth: 480 }}>
            <strong style={{ color: 'var(--text-2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 4 }}>
              项目背景
            </strong>
            {project.background}
          </p>
        )}
      </div>
    </div>
  );
}
