'use client';

/**
 * 项目详情视图 — Client Component
 *
 * V1: 左侧 Intent 看板 + 中间画布 + 双向 provenance 联动。
 * 讨论抽屉是 V2 才上线的能力,V1 直接不渲染。
 *
 * Provenance 联动 (双向):
 *   - hover 一条 Intent 卡片 → iframe 内对应 scope 的 section 加 outline
 *   - hover iframe 内一个 section → 影响该 scope 的 Intent 卡片高亮、其余变灰
 *   - global scope 的 Intent 跟所有 section 联动 (用 '*' 表示)
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Project, Intent } from '@/lib/types';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL } from '@/lib/type-meta';
import IntentCard from '@/components/IntentCard';
import IntentForm from '@/components/IntentForm';
import ProjectActionsMenu from '@/components/ProjectActionsMenu';
import ProjectCanvas from '@/components/ProjectCanvas';
import type { Version } from '@/lib/versions';

const EMPTY_SET: ReadonlySet<string> = new Set();

function scopesForIntent(intent: Intent): ReadonlySet<string> {
  if (intent.scope === 'global') return new Set(['*']);
  // 'pricing.team' → match section data-scope='pricing'
  const head = intent.scope.split('.')[0];
  return new Set([head]);
}

function intentMatchesSectionScope(intent: Intent, sectionScope: string): boolean {
  if (intent.scope === 'global') return true;
  return intent.scope === sectionScope || intent.scope.startsWith(sectionScope + '.');
}

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
  const [hoveredIntentId, setHoveredIntentId] = useState<string | null>(null);
  const [hoveredSectionScope, setHoveredSectionScope] = useState<string | null>(null);

  // canvas 高亮的 scope 集合: hover Intent 卡片驱动
  const highlightScopes = useMemo<ReadonlySet<string>>(() => {
    if (!hoveredIntentId) return EMPTY_SET;
    const intent = intents.find(i => i.id === hoveredIntentId);
    if (!intent) return EMPTY_SET;
    return scopesForIntent(intent);
  }, [hoveredIntentId, intents]);

  // 哪些 IntentCard 应该高亮: 由 hover section 驱动
  const intentHighlightSet = useMemo<ReadonlySet<string>>(() => {
    if (!hoveredSectionScope) return EMPTY_SET;
    const ids = intents
      .filter(i => intentMatchesSectionScope(i, hoveredSectionScope))
      .map(i => i.id);
    return new Set(ids);
  }, [hoveredSectionScope, intents]);

  const anyHover = hoveredIntentId !== null || hoveredSectionScope !== null;

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

          <div className={`board-list ${anyHover ? 'is-prov-active' : ''}`}>
            {intents.length === 0 ? (
              <div className="board-empty">
                <strong>大家各抒己见</strong>
                AI 自动抽取为可合并的 Intent
                <br />
                信息足够时自动开始合成
              </div>
            ) : (
              intents.map(i => (
                <IntentCard
                  key={i.id}
                  intent={i}
                  isHovered={hoveredIntentId === i.id || intentHighlightSet.has(i.id)}
                  isDimmed={anyHover && !(hoveredIntentId === i.id || intentHighlightSet.has(i.id))}
                  onMouseEnter={() => setHoveredIntentId(i.id)}
                  onMouseLeave={() => setHoveredIntentId(null)}
                />
              ))
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
                  <span className="prov-hint"> · hover 卡片看产物联动</span>
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
              highlightScopes={highlightScopes}
              onSectionHover={setHoveredSectionScope}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
