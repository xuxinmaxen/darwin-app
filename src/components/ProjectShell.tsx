'use client';

/**
 * 项目详情视图 — Client Component
 *
 * V1: 左侧 Intent 看板 + 中间画布 + 顶栏 (溯源 / 版本 / 发布) + 双向 provenance 联动。
 * 讨论抽屉是 V2 才上线的能力,V1 不渲染。
 *
 * 顶栏控制:
 *   - 溯源 toggle:  开了之后 traceMode=true,产物每个 section 加 outline + pill
 *   - 版本面板:    本阶段先 stub (按钮存在,面板下个 commit 实现)
 *   - 发布:        本阶段先 stub (按钮存在,POST 路径下个 commit 实现)
 *
 * Provenance 联动 (双向, 见 v1 step 14):
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
import TopbarControls from '@/components/TopbarControls';
import VersionsPanel from '@/components/VersionsPanel';
import CelebrationModal from '@/components/CelebrationModal';
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
  versionsTotal: initialVersionsTotal,
}: {
  project: Project;
  intents: Intent[];
  claudeReady: boolean;
  initialVersion: Version | null;
  versionsTotal: number;
}) {
  // ─── State ─────────────────────────────────────────────
  const [hoveredIntentId, setHoveredIntentId] = useState<string | null>(null);
  const [hoveredSectionScope, setHoveredSectionScope] = useState<string | null>(null);
  const [traceMode, setTraceMode] = useState(false);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [versionsTotal, setVersionsTotal] = useState(initialVersionsTotal);
  const [currentVersion, setCurrentVersion] = useState<Version | null>(initialVersion);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<'draft' | 'published'>(
    project.status === 'published' ? 'published' : 'draft'
  );
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [publishStats, setPublishStats] = useState<{ intents: number; versions: number } | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // ─── Version handlers ──────────────────────────────────
  const handleVersionCreated = (v: Version) => {
    setCurrentVersion(v);
    setVersionsTotal(n => n + 1);
  };

  const handlePreview = async (versionId: string) => {
    setPreviewError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/versions/${versionId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPreviewError(json.error || `加载版本失败 (${res.status})`);
        return;
      }
      setPreviewVersion(json.version);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExitPreview = () => setPreviewVersion(null);

  const handleRollbacked = () => {
    // rollback 写了一条新 version → 让 ProjectCanvas 重新拉最新当前版本
    fetch(`/api/projects/${project.id}/synthesize`, { method: 'GET' })
      .then(r => r.json())
      .then(j => {
        if (j.ok && j.version) {
          setCurrentVersion(j.version);
          setVersionsTotal(n => n + 1);
        }
      })
      .catch(() => {/* swallow */});
    setPreviewVersion(null);
    setVersionPanelOpen(false);
  };

  // ─── Computed ──────────────────────────────────────────
  // 每个 scope 关键字 → 对应 Intent 数量 (溯源模式下 pill 显示这个数)
  const intentScopeCounts = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const i of intents) {
      const key = i.scope === 'global' ? '*' : i.scope.split('.')[0];
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [intents]);

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

  const versionLabel = `v${versionsTotal}`;
  const isPublished = publishStatus === 'published';
  const canPublish = versionsTotal > 0 && !publishing && !isPublished;

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPublishError(json.error || `发布失败 (${res.status})`);
        return;
      }
      setPublishStatus('published');
      setPublishStats({
        intents: json.stats?.intents ?? intents.length,
        versions: versionsTotal,
      });
      setCelebrationOpen(true);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="view-project">
      {/* TOP BAR */}
      <div className="topbar">
        <Link
          href="/"
          className="brand"
          style={{ textDecoration: 'none', color: 'inherit' }}
          title="返回工作台"
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

        <TopbarControls
          traceMode={traceMode}
          onTraceToggle={() => setTraceMode(v => !v)}
          versionLabel={versionLabel}
          versionsTotal={versionsTotal}
          versionPanelOpen={versionPanelOpen}
          onVersionsToggle={() => setVersionPanelOpen(v => !v)}
          canPublish={canPublish}
          isPublished={isPublished}
          publishing={publishing}
          onPublishClick={handlePublish}
        />

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
            <span className={`status-icon ${intents.length === 0 ? 'idle' : currentVersion ? 'done' : ''}`} />
            <span className="status-text">
              {intents.length === 0 ? (
                <>等待输入。所有人到齐后，AI 会把意图合成为产物。</>
              ) : currentVersion ? (
                <>
                  已合成 · <strong>{intents.length}</strong> 条 Intent · {TYPE_LABEL[project.type]}
                  <span className="prov-hint">
                    {' · '}
                    {traceMode ? '溯源中,每块标记来源数' : 'hover 卡片看产物联动'}
                  </span>
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
              currentVersion={currentVersion}
              previewVersion={previewVersion}
              claudeReady={claudeReady}
              highlightScopes={highlightScopes}
              onSectionHover={setHoveredSectionScope}
              traceMode={traceMode}
              intentScopeCounts={intentScopeCounts}
              onVersionCreated={handleVersionCreated}
              onExitPreview={handleExitPreview}
            />
          </div>
        </section>
      </div>

      {versionPanelOpen && (
        <VersionsPanel
          projectId={project.id}
          currentVersionId={currentVersion?.id ?? null}
          previewVersionId={previewVersion?.id ?? null}
          onClose={() => setVersionPanelOpen(false)}
          onPreview={handlePreview}
          onExitPreview={handleExitPreview}
          onRollbacked={handleRollbacked}
        />
      )}
      {previewError && (
        <div className="ver-preview-error" role="alert">
          {previewError}
          <button type="button" onClick={() => setPreviewError(null)} aria-label="dismiss">×</button>
        </div>
      )}
      {publishError && (
        <div className="ver-preview-error" role="alert">
          ⚠️ 发布失败：{publishError}
          <button type="button" onClick={() => setPublishError(null)} aria-label="dismiss">×</button>
        </div>
      )}

      <CelebrationModal
        open={celebrationOpen}
        title="恭喜，产物完成定稿"
        sub={
          <>
            <strong>{publishStats?.intents ?? intents.length}</strong> 条 Intent 都活在了产物里——
            <br />
            这是 v1 的一份{TYPE_LABEL[project.type]}定稿。
          </>
        }
        stats={[
          { num: publishStats?.intents ?? intents.length, label: 'Intent 命中' },
          { num: 1, label: '位贡献者' },
          { num: 0, label: '次冲突共识' },
          { num: `v${publishStats?.versions ?? versionsTotal}`, label: '产物版本' },
        ]}
        onClose={() => setCelebrationOpen(false)}
      />
    </div>
  );
}
