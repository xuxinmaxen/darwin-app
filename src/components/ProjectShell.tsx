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
import { useEffect, useMemo, useState } from 'react';
import type { Project, Intent } from '@/lib/types';
import { TYPE_LABEL, TypeIcon, STATUS_LABEL } from '@/lib/type-meta';
import IntentCard from '@/components/IntentCard';
import IntentForm from '@/components/IntentForm';
import AgentSpeakBar from '@/components/AgentSpeakBar';
import ProjectCanvas from '@/components/ProjectCanvas';
import TopbarControls from '@/components/TopbarControls';
import VersionsPanel from '@/components/VersionsPanel';
import CollaboratorsPanel from '@/components/CollaboratorsPanel';
import CelebrationModal from '@/components/CelebrationModal';
import TensionCard from '@/components/TensionCard';
import DiscussionDrawer from '@/components/DiscussionDrawer';
import ProjectSettingsPanel from '@/components/ProjectSettingsPanel';
import PrefCandidateToast from '@/components/PrefCandidateToast';
import type { PrefCandidate } from '@/lib/types';
import type { Version } from '@/lib/versions';
import type { Employee } from '@/lib/employees';
import type { Tension, Thread, ThreadMessage } from '@/lib/types';

const MAX_TOPBAR_AVATARS = 5;

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
  collaborators,
  activeTensions: initialActiveTensions,
}: {
  project: Project;
  intents: Intent[];
  claudeReady: boolean;
  initialVersion: Version | null;
  versionsTotal: number;
  collaborators: Employee[];
  activeTensions: Tension[];
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
  const [publishStats, setPublishStats] = useState<{
    intents: number;
    versions: number;
    consensusCount: number;
    contributorCount: number;
  } | null>(null);
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

  // 协作者: 本地 state, 面板修改后即时反映
  const [collaboratorsState, setCollaboratorsState] = useState<Employee[]>(collaborators);
  const [collabPanelOpen, setCollabPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conflictMode, setConflictMode] = useState(project.conflictMode);
  const [prefCandidates, setPrefCandidates] = useState<PrefCandidate[]>([]);

  // Tensions: 本地 state, 解决/检测出新的会更新
  const [activeTensions, setActiveTensions] = useState<Tension[]>(initialActiveTensions);

  // 讨论抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [activeMessages, setActiveMessages] = useState<ThreadMessage[]>([]);
  const [agentsThinkingInThread, setAgentsThinkingInThread] = useState<Set<string>>(
    new Set()
  );

  // 关联当前 thread 的 tension (内联仲裁需要)
  const activeThreadTension = useMemo(() => {
    if (!activeThread?.tensionId) return null;
    return activeTensions.find(t => t.id === activeThread.tensionId) ?? null;
  }, [activeThread, activeTensions]);

  async function loadThreadMessages(threadId: string) {
    const res = await fetch(`/api/threads/${threadId}/messages`);
    const json = await res.json();
    if (json.ok) setActiveMessages(json.messages);
  }

  // tension 涉及的 agent 们各自 fire-and-forget 发一条 thread 消息;
  // 全部落地后再统一 reload 一次消息列表。
  function triggerAgentsInThread(threadId: string, agentIds: string[]) {
    if (agentIds.length === 0) return;
    setAgentsThinkingInThread(new Set(agentIds));
    const inflight = agentIds.map(id =>
      fetch(`/api/threads/${threadId}/agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentEmployeeId: id }),
      }).catch(() => undefined)
    );
    Promise.allSettled(inflight).finally(() => {
      setAgentsThinkingInThread(new Set());
      // 拿最新消息 (含 agent 的发言)
      void loadThreadMessages(threadId);
    });
  }

  async function openDiscussion(args: {
    scope: string;
    title: string;
    tensionId?: string | null;
    opening: string;
  }) {
    try {
      const res = await fetch(`/api/projects/${project.id}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: args.scope,
          title: args.title,
          tensionId: args.tensionId ?? null,
          openingMessages: [
            {
              authorId: 'system',
              authorKind: 'system',
              body: args.opening,
            },
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) return;
      setActiveThread(json.thread);
      setDrawerOpen(true);
      await loadThreadMessages(json.thread.id);
    } catch {
      // 静默
    }
  }

  function handleDiscussIntent(intent: Intent) {
    const author = employeeById.get(intent.authorId);
    const authorName = author?.name ?? '匿名';
    const scopeHead = intent.scope.split('.')[0];
    const opening = [
      `**徐鑫** 在 **${intent.scope}** 区块发起讨论`,
      '',
      `围绕 **${authorName}** 的 Intent: ${intent.statement}`,
    ].join('\n');
    void openDiscussion({
      scope: scopeHead === 'global' ? 'global' : scopeHead,
      title: `${intent.scope} · 围绕 Intent 讨论`,
      opening,
    });
  }

  async function handleDiscussTension(tension: Tension) {
    // 找/创建 tension 关联的 thread
    const partyA = intentById.get(tension.intentIds[0]);
    const partyB = intentById.get(tension.intentIds[1]);
    const partyAName = partyA ? (employeeById.get(partyA.authorId)?.name ?? '?') : '?';
    const partyBName = partyB ? (employeeById.get(partyB.authorId)?.name ?? '?') : '?';

    const openingBody = [
      `**${tension.scope}** 区块发现冲突: **${partyAName}** ⇄ **${partyBName}**`,
      '',
      `${partyAName} 主张: ${partyA?.statement ?? '?'}`,
      `${partyBName} 主张: ${partyB?.statement ?? '?'}`,
      '',
      'AI 已生成 3 个调和方案 (见下方),团队可在此讨论或直接选定。',
    ].join('\n');

    try {
      const res = await fetch(`/api/projects/${project.id}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: tension.scope,
          title: `${tension.scope} · ${partyAName} ⇄ ${partyBName}`,
          tensionId: tension.id,
          openingMessages: [
            {
              authorId: 'system',
              authorKind: 'system',
              body: openingBody,
            },
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) return;
      setActiveThread(json.thread);
      setDrawerOpen(true);
      await loadThreadMessages(json.thread.id);

      // tension 双方有 agent → fire-and-forget 让它在 thread 里发言
      const involvedAgentIds = new Set<string>();
      for (const intentId of tension.intentIds) {
        const intent = intentById.get(intentId);
        if (intent && intent.authorKind === 'agent') {
          involvedAgentIds.add(intent.authorId);
        }
      }
      if (involvedAgentIds.size > 0) {
        triggerAgentsInThread(json.thread.id, Array.from(involvedAgentIds));
      }
    } catch {
      // 静默
    }
  }

  async function handleSendMessage(body: string) {
    if (!activeThread) return;
    const res = await fetch(`/api/threads/${activeThread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const json = await res.json();
    if (json.ok) {
      setActiveMessages(prev => [...prev, json.message]);
    } else {
      throw new Error(json.error || '发送失败');
    }
  }

  async function handleResolveUserThread() {
    if (!activeThread || activeThread.tensionId) return;
    const res = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || '收敛失败');
    }
    setActiveThread(prev => (prev ? { ...prev, status: 'resolved' } : prev));
    await loadThreadMessages(activeThread.id);
  }

  async function handleDrawerResolveTension(selectedOptionKey: string) {
    if (!activeThread?.tensionId) return;
    const res = await fetch(
      `/api/projects/${project.id}/tensions/${activeThread.tensionId}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOptionKey }),
      }
    );
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || '决议失败');
    }
    // tension 关闭 + thread 关闭 + 重新拉消息让 system "决议" 消息出现
    setActiveTensions(prev => prev.filter(t => t.id !== activeThread.tensionId));
    setActiveThread(prev => (prev ? { ...prev, status: 'resolved' } : prev));
    await loadThreadMessages(activeThread.id);
    // 给用户看到"已收敛"动画后再 reload
    setTimeout(() => window.location.reload(), 800);
  }

  const intentById = useMemo(() => {
    const m = new Map<string, Intent>();
    for (const i of intents) m.set(i.id, i);
    return m;
  }, [intents]);

  const handleTensionResolved = (tensionId: string) => {
    setActiveTensions(prev => prev.filter(t => t.id !== tensionId));
    // 触发 router refresh 让看板和产物按新决议重新合成
    if (typeof window !== 'undefined') {
      // Tension 解决后让 ProjectCanvas 检测到 intents 没变但需要重合成 — 现状是
      // canvas 自动合成基于 intent hash, tension 解决不变 hash。简化做法:
      // 直接 location.reload 让所有数据 (含 versions count) 都刷新一遍。
      // 重载后 ProjectShell mount 会自动拉候选 (5s/12s/22s 三次轮询)
      window.location.reload();
    }
  };

  // 轮询 active tensions (LLM 检测是 fire-and-forget, 客户端要主动拉)
  // 在用户加 Intent 后短时间内拉几次, 避免错过新冒出来的 tension
  useEffect(() => {
    let cancelled = false;
    const poll = async (delayMs: number) => {
      await new Promise(r => setTimeout(r, delayMs));
      if (cancelled) return;
      try {
        const res = await fetch(`/api/projects/${project.id}/tensions`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          const active = (json.tensions as Tension[]).filter(t => t.status === 'active');
          setActiveTensions(active);
        }
      } catch {
        // 静默
      }
    };
    // intents.length 变化后 5s / 12s 各拉一次 (检测异步, 一般 5-15s 内完成)
    poll(5000);
    poll(12000);
    return () => { cancelled = true; };
  }, [intents.length, project.id]);

  // 抽屉打开 + thread 关联 active tension 时, 轮询 thread 状态:
  // 因为 AI 共识检测可能在用户不点 A/B/C 的情况下自动 resolve,
  // 客户端需要看到 thread.status 切到 resolved + 新 system 决议消息出现。
  useEffect(() => {
    if (!drawerOpen || !activeThread) return;
    if (activeThread.status !== 'active' || !activeThread.tensionId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const [tRes, mRes] = await Promise.all([
          fetch(`/api/threads/${activeThread.id}`),
          fetch(`/api/threads/${activeThread.id}/messages`),
        ]);
        const tJson = await tRes.json();
        const mJson = await mRes.json();
        if (cancelled) return;
        if (mJson.ok) setActiveMessages(mJson.messages);
        if (tJson.ok && tJson.thread.status === 'resolved') {
          setActiveThread(tJson.thread);
          // tension 也已经 resolve 了, 从 active list 摘掉
          if (activeThread.tensionId) {
            setActiveTensions(prev => prev.filter(t => t.id !== activeThread.tensionId));
          }
        }
      } catch { /* 静默 */ }
    };
    const iv = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [drawerOpen, activeThread]);

  // 拉团队共识候选 (tension resolve 后 LLM 异步抽出, 5-15s 内会出现)
  useEffect(() => {
    let cancelled = false;
    const tick = async (delayMs: number) => {
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      if (cancelled) return;
      try {
        const res = await fetch(`/api/projects/${project.id}/pref-candidates`);
        const json = await res.json();
        if (!cancelled && json.ok) setPrefCandidates(json.candidates);
      } catch { /* 静默 */ }
    };
    // 立刻一次, 再 5s/12s/22s 各拉一次, 兜住 LLM 抽取的延迟窗口
    tick(0);
    tick(5_000);
    tick(12_000);
    tick(22_000);
    return () => { cancelled = true; };
  }, [project.id]);
  const employeeById = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of collaboratorsState) m.set(e.id, e);
    return m;
  }, [collaboratorsState]);
  const agentCollaborators = useMemo(
    () => collaboratorsState.filter(e => e.kind === 'agent'),
    [collaboratorsState]
  );

  // ─── Computed ──────────────────────────────────────────
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
        consensusCount: json.stats?.consensusCount ?? 0,
        contributorCount:
          json.stats?.contributorCount ?? collaboratorsState.length,
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

        <button
          type="button"
          className="ctrl proj-settings-btn"
          title={`项目设置 · 冲突默认 ${conflictMode === 'ai_decide' ? 'AI 评分决策' : '开讨论'}`}
          onClick={() => setSettingsOpen(true)}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
            <circle cx="7" cy="7" r="2.2" />
            <path d="M7 1.4v1.4M7 11.2v1.4M1.4 7h1.4M11.2 7h1.4M3 3l1 1M10 10l1 1M3 11l1-1M10 4l1-1" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="ws-user proj-collab proj-collab-topbar proj-collab-topbar-btn"
          title="管理协作者"
          onClick={() => setCollabPanelOpen(true)}
        >
          {collaboratorsState.slice(0, MAX_TOPBAR_AVATARS).map(e => (
            <span
              key={e.id}
              className={`avatar ${e.cls}${e.kind === 'agent' ? ' agent' : ''}`}
              title={`${e.name} · ${e.role}${e.kind === 'agent' ? '（Agent）' : ''}`}
            >
              {e.short}
            </span>
          ))}
          {collaboratorsState.length > MAX_TOPBAR_AVATARS && (
            <span
              className="avatar avatar-more"
              title={`还有 ${collaboratorsState.length - MAX_TOPBAR_AVATARS} 位`}
            >
              +{collaboratorsState.length - MAX_TOPBAR_AVATARS}
            </span>
          )}
        </button>
      </div>

      {/* MAIN GRID — V1: 2 cols (board + canvas). V2 加上讨论抽屉 */}
      <div className={`main main-v1${drawerOpen ? ' has-drawer' : ''}`}>
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
                  author={employeeById.get(i.authorId) ?? null}
                  isHovered={hoveredIntentId === i.id || intentHighlightSet.has(i.id)}
                  isDimmed={anyHover && !(hoveredIntentId === i.id || intentHighlightSet.has(i.id))}
                  onMouseEnter={() => setHoveredIntentId(i.id)}
                  onMouseLeave={() => setHoveredIntentId(null)}
                  onDiscuss={handleDiscussIntent}
                />
              ))
            )}
          </div>

          <AgentSpeakBar projectId={project.id} agents={agentCollaborators} />
          <IntentForm projectId={project.id} agents={agentCollaborators} />
        </aside>

        {/* CENTER: CANVAS */}
        <section className="canvas-wrap">
          <div className={`statusbar${activeTensions.length > 0 ? ' has-tension' : ''}`}>
            <span className={`status-icon ${activeTensions.length > 0 ? 'tension' : intents.length === 0 ? 'idle' : currentVersion ? 'done' : ''}`} />
            <span className="status-text">
              {activeTensions.length > 0 ? (
                <>
                  检测到 <strong>{activeTensions.length}</strong> 个未决冲突 ·
                  AI 已提议调和方案,等待项目 Owner 拍板
                </>
              ) : intents.length === 0 ? (
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

          {activeTensions.length > 0 && (
            <div className="tension-stack">
              {activeTensions.map(t => (
                <TensionCard
                  key={t.id}
                  projectId={project.id}
                  tension={t}
                  intentMap={intentById}
                  employeeMap={employeeById}
                  conflictMode={conflictMode}
                  onResolved={handleTensionResolved}
                  onDiscuss={handleDiscussTension}
                />
              ))}
            </div>
          )}

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
              onVersionCreated={handleVersionCreated}
              onExitPreview={handleExitPreview}
            />
          </div>
        </section>

        {drawerOpen && (
          <DiscussionDrawer
            open={drawerOpen}
            thread={activeThread}
            messages={activeMessages}
            tension={activeThreadTension}
            employeeMap={employeeById}
            agentsThinkingIds={agentsThinkingInThread}
            onClose={() => setDrawerOpen(false)}
            onSend={handleSendMessage}
            onResolveTension={handleDrawerResolveTension}
            onResolveUserThread={handleResolveUserThread}
          />
        )}
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

      <CollaboratorsPanel
        open={collabPanelOpen}
        projectId={project.id}
        current={collaboratorsState}
        onClose={() => setCollabPanelOpen(false)}
        onSaved={next => {
          setCollaboratorsState(next);
          setCollabPanelOpen(false);
        }}
      />

      {prefCandidates.length > 0 && (
        <div className="pref-toast-stack">
          {prefCandidates.map(c => (
            <PrefCandidateToast
              key={c.id}
              candidate={c}
              onAccepted={id =>
                setPrefCandidates(prev => prev.filter(x => x.id !== id))
              }
              onDismissed={id =>
                setPrefCandidates(prev => prev.filter(x => x.id !== id))
              }
            />
          ))}
        </div>
      )}

      <ProjectSettingsPanel
        open={settingsOpen}
        projectId={project.id}
        projectName={project.name}
        initialMode={conflictMode}
        onClose={() => setSettingsOpen(false)}
        onSaved={mode => {
          setConflictMode(mode);
          setSettingsOpen(false);
        }}
      />

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
          { num: publishStats?.contributorCount ?? collaboratorsState.length, label: '位贡献者' },
          { num: publishStats?.consensusCount ?? 0, label: '次冲突共识' },
          { num: `v${publishStats?.versions ?? versionsTotal}`, label: '产物版本' },
        ]}
        onClose={() => setCelebrationOpen(false)}
      />
    </div>
  );
}
