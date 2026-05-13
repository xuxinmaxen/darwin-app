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
import { useEffect, useMemo, useRef, useState } from 'react';
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
import UserMenu from '@/components/UserMenu';
import type { CurrentUserMini } from '@/components/WorkspaceShell';
import TensionCard from '@/components/TensionCard';
import DiscussionDrawer from '@/components/DiscussionDrawer';
import ProjectSettingsPanel from '@/components/ProjectSettingsPanel';
import ThemeToggle from '@/components/ThemeToggle';
import Heartbeat from '@/components/Heartbeat';
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
  currentUser,
}: {
  project: Project;
  intents: Intent[];
  claudeReady: boolean;
  initialVersion: Version | null;
  versionsTotal: number;
  collaborators: Employee[];
  activeTensions: Tension[];
  currentUser?: CurrentUserMini;
}) {
  // ─── State ─────────────────────────────────────────────
  const [hoveredIntentId, setHoveredIntentId] = useState<string | null>(null);
  const [hoveredSectionScope, setHoveredSectionScope] = useState<string | null>(null);
  const [traceMode, setTraceMode] = useState(false);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [versionsTotal, setVersionsTotal] = useState(initialVersionsTotal);
  const [currentVersion, setCurrentVersion] = useState<Version | null>(initialVersion);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  // 开始合成时快照当时的 intentIds，用于在生成中状态下精确定位分界线
  const [synthesisPendingIds, setSynthesisPendingIds] = useState<Set<string>>(new Set());
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
  // Agent 学习通知 (发布后出现)
  const [agentLearningToasts, setAgentLearningToasts] = useState<
    { id: number; name: string; phase: 'learning' | 'done' }[]
  >([]);

  // 每次对立调和后弹一次"共识时刻"
  const [consensusOpen, setConsensusOpen] = useState(false);
  const [consensusStats, setConsensusStats] = useState<{
    nth: number;
    partyAName: string;
    partyBName: string;
    optionKey: string;
    contributorCount: number;
  } | null>(null);
  // 模态关闭后再 reload, 让用户看到"共识时刻"再让产物重合成
  const pendingReloadRef = useRef(false);
  // 意图看板列表 ref — 有新意图时自动滚到底部
  const boardListRef = useRef<HTMLDivElement | null>(null);
  // Agent 反应进行中 → 阻断自动合成,防止分界线在 agent 意图可见前就定位
  const [agentsReacting, setAgentsReacting] = useState(false);

  // 冲突列表默认折叠, 点 statusbar 展开/收起 (多个 tension 时挤画布, 默认收起)
  const [tensionExpanded, setTensionExpanded] = useState<boolean>(false);

  // 有新意图加入时自动滚到看板底部
  const prevIntentsLenRef = useRef(intents.length);
  useEffect(() => {
    if (intents.length > prevIntentsLenRef.current) {
      // rAF 确保 React 已完成 DOM 更新后再计算 scrollHeight
      requestAnimationFrame(() => {
        boardListRef.current?.scrollTo({
          top: boardListRef.current.scrollHeight,
          behavior: 'smooth',
        });
      });
    }
    prevIntentsLenRef.current = intents.length;
  }, [intents.length]);

  const handleConsensusModalClose = () => {
    setConsensusOpen(false);
    if (pendingReloadRef.current) {
      pendingReloadRef.current = false;
      window.location.reload();
    }
  };

  function showConsensusFor(tension: Tension, selectedKey: string) {
    const partyAIntent = intentById.get(tension.intentIds[0]);
    const partyBIntent = intentById.get(tension.intentIds[1]);
    const partyA = partyAIntent ? employeeById.get(partyAIntent.authorId) : null;
    const partyB = partyBIntent ? employeeById.get(partyBIntent.authorId) : null;
    const uniqueAuthors = new Set(
      tension.intentIds
        .map(id => intentById.get(id)?.authorId)
        .filter((x): x is string => !!x)
    );
    setConsensusStats(prev => ({
      nth: (prev?.nth ?? 0) + 1,
      partyAName: partyA?.name ?? '一方',
      partyBName: partyB?.name ?? '另一方',
      optionKey: selectedKey,
      contributorCount: uniqueAuthors.size || tension.intentIds.length,
    }));
    setConsensusOpen(true);
  }

  // ─── Version handlers ──────────────────────────────────
  const handleVersionCreated = (v: Version) => {
    setCurrentVersion(v);
    setVersionsTotal(n => n + 1);
    setIsSynthesizing(false);
    setSynthesisPendingIds(new Set()); // 清空待合成快照
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

  // 历史讨论面板
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allThreads, setAllThreads] = useState<Thread[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function openDiscussionForThread(t: Thread) {
    setActiveThread(t);
    setDrawerOpen(true);
    await loadThreadMessages(t.id);
  }

  async function loadAllThreads() {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/threads`);
      const json = await res.json();
      if (json.ok) setAllThreads(json.threads ?? []);
    } catch { /* swallow */ }
    finally { setLoadingHistory(false); }
  }

  function openHistory() {
    setHistoryOpen(true);
    loadAllThreads();
  }

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
    const initiatorName = currentUser?.name ?? '项目 Owner';
    const opening = [
      `**${initiatorName}** 在 **${intent.scope}** 区块发起讨论`,
      '',
      `围绕 **${authorName}** 的意图: ${intent.statement}`,
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
    const resolvedTension = activeTensions.find(
      t => t.id === activeThread.tensionId
    );
    setActiveTensions(prev => prev.filter(t => t.id !== activeThread.tensionId));
    setActiveThread(prev => (prev ? { ...prev, status: 'resolved' } : prev));
    await loadThreadMessages(activeThread.id);
    // 先弹"共识时刻", 关闭后再 reload
    if (resolvedTension) {
      showConsensusFor(resolvedTension, selectedOptionKey);
      pendingReloadRef.current = true;
    } else {
      setTimeout(() => window.location.reload(), 800);
    }
  }

  const intentById = useMemo(() => {
    const m = new Map<string, Intent>();
    for (const i of intents) m.set(i.id, i);
    return m;
  }, [intents]);

  const handleTensionResolved = (tension: Tension, selectedKey: string) => {
    setActiveTensions(prev => prev.filter(t => t.id !== tension.id));
    if (typeof window === 'undefined') return;
    // 先弹"共识时刻"庆祝, 用户点继续后再 reload
    showConsensusFor(tension, selectedKey);
    pendingReloadRef.current = true;
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
      // 发布后 — 给每个 Agent 协作者弹一个"学习中"通知，1.5s 后变"已学习"
      const agentNames: string[] = json.stats?.agentNames ?? [];
      if (agentNames.length > 0) {
        const toasts = agentNames.map((name: string, i: number) => ({
          id: Date.now() + i, name, phase: 'learning' as const,
        }));
        setAgentLearningToasts(toasts);
        setTimeout(() => {
          setAgentLearningToasts(prev =>
            prev.map(t => ({ ...t, phase: 'done' as const }))
          );
        }, 1800);
        setTimeout(() => setAgentLearningToasts([]), 5500);
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="view-project">
      <Heartbeat />
      {/* TOP BAR */}
      <div className="topbar">
        <Link
          href="/"
          className="brand"
          style={{ textDecoration: 'none', color: 'inherit' }}
          title="返回工作台"
        >
          <div className="brand-logo" aria-hidden />
          <span className="brand-text">
            <span className="brand-name">Darwin</span>
            <span className="brand-tagline">组织的每一次共识，即是每一次进化。</span>
          </span>
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

        {/* 协作者头像组 — 居中显示带在线状态 */}
        <button
          type="button"
          className="ws-user proj-collab proj-collab-topbar proj-collab-topbar-btn proj-collab-center"
          title="管理项目成员"
          onClick={() => setCollabPanelOpen(true)}
        >
          {collaboratorsState.slice(0, MAX_TOPBAR_AVATARS).map(e => {
            const isOnline = e.kind === 'agent' || e.isOnline;
            return (
              <span key={e.id} className="collab-topbar-wrap">
                <span
                  className={`avatar ${e.cls}${e.kind === 'agent' ? ' agent' : ''}`}
                  title={`${e.name} · ${e.role}${e.kind === 'agent' ? '（永远在线）' : isOnline ? '（在线）' : '（离线）'}`}
                >
                  {e.short}
                </span>
                <span className={`collab-topbar-dot${isOnline ? ' online' : ' offline'}`} aria-hidden />
              </span>
            );
          })}
          {collaboratorsState.length > MAX_TOPBAR_AVATARS && (
            <span className="avatar avatar-more" title={`还有 ${collaboratorsState.length - MAX_TOPBAR_AVATARS} 位`}>
              +{collaboratorsState.length - MAX_TOPBAR_AVATARS}
            </span>
          )}
        </button>

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
          projectType={project.type}
          projectId={project.id}
          hasVersion={currentVersion !== null}
        />

        <ThemeToggle />

        {/* 分隔线 */}
        <span className="topbar-avatar-sep" aria-hidden />

        {/* 当前用户头像 + 菜单 */}
        {currentUser && <UserMenu user={currentUser} />}
      </div>

      {/* MAIN GRID — V1: 2 cols (board + canvas). V2 加上讨论抽屉 */}
      <div className={`main main-v1${drawerOpen ? ' has-drawer' : ''}`}>
        {/* LEFT: INTENT BOARD */}
        <aside className="board">
          <div className="board-head">
            <div className="board-head-text">
              <span className="board-title">意图看板</span>
              <span className="board-sub">团队此刻在想什么</span>
            </div>
            <button
              type="button"
              className="board-history-btn"
              onClick={openHistory}
              title="查看所有历史讨论"
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M2 5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H6l-3 2v-2a3 3 0 0 1-1-2.5V5z" strokeLinejoin="round"/>
              </svg>
              历史讨论
            </button>
          </div>

          <div ref={boardListRef} className={`board-list ${anyHover ? 'is-prov-active' : ''}`}>
            {intents.length === 0 ? (
              <div className="board-empty">
                <strong>说一句你想要什么</strong>
                AI 会理解你的意图,把它放进产物里
                <br />
                每条意图都会留下来,不会被淹没
              </div>
            ) : (
              (() => {
                // 上一个完成版本包含的 intentIds
                const synthIds = new Set(currentVersion?.intentIds ?? []);
                // lastSynthIndex: 已完成版本里最后一条意图的位置
                let lastSynthIndex = -1;
                if (currentVersion && synthIds.size > 0) {
                  for (let idx = intents.length - 1; idx >= 0; idx--) {
                    if (synthIds.has(intents[idx].id)) { lastSynthIndex = idx; break; }
                  }
                }
                // pendingLastIndex: 本次合成快照的最后一条意图的位置
                // (仅在合成进行时有效,用于精确定位"生成中"分界线)
                let pendingLastIndex = -1;
                if (isSynthesizing && synthesisPendingIds.size > 0) {
                  for (let idx = intents.length - 1; idx >= 0; idx--) {
                    if (synthesisPendingIds.has(intents[idx].id)) { pendingLastIndex = idx; break; }
                  }
                }

                const prevVersion = versionsTotal;
                const nextVersion = versionsTotal + 1;

                const cards: React.ReactNode[] = [];
                intents.forEach((i, idx) => {
                  cards.push(
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
                  );

                  // ── 分界线 1: 已完成版本标记 ────────────────────────────────
                  // 合成完成后始终展示，让用户知道每个版本结合了哪些意图。
                  // 若合成进行中且"已完成"和"生成中"位置相同则跳过(避免重叠)
                  const doneVisible = currentVersion && idx === lastSynthIndex;
                  const doneOverlapsActive = isSynthesizing && lastSynthIndex === pendingLastIndex;
                  if (doneVisible && !doneOverlapsActive) {
                    cards.push(
                      <div key="synth-done" className="board-synth-boundary board-synth-done">
                        <span className="board-synth-badge board-synth-badge-done">
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                            <path d="M2.5 6.5L5 9l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          v{prevVersion} 已完成
                        </span>
                        <div className="board-synth-line board-synth-line-done" />
                      </div>
                    );
                  }

                  // ── 分界线 2: 生成中标记 ─────────────────────────────────────
                  // 精确定位在本次合成快照的最后一条意图下方；
                  // 用户在合成过程中新增的意图出现在此线下方，等待下次合成。
                  if (isSynthesizing && idx === pendingLastIndex) {
                    cards.push(
                      <div key="synth-ing" className="board-synth-boundary board-synth-ing">
                        <span className="board-synth-badge board-synth-badge-active">
                          <span className="board-synth-pulse" aria-hidden />
                          v{nextVersion} 生成中…
                        </span>
                        <div className="board-synth-line board-synth-line-active" />
                      </div>
                    );
                  }
                });
                return cards;
              })()
            )}
          </div>

          <AgentSpeakBar projectId={project.id} agents={agentCollaborators} />
          <IntentForm
            projectId={project.id}
            agents={agentCollaborators}
            currentUserCls={currentUser?.cls ?? 'xu'}
            currentUserShort={currentUser?.short ?? '我'}
            onAgentsReacting={setAgentsReacting}
          />
        </aside>

        {/* CENTER: CANVAS */}
        <section className="canvas-wrap">
          <div
            className={`statusbar${activeTensions.length > 0 ? ' has-tension' : ''}${activeTensions.length > 0 ? ' is-tension-toggle' : ''}`}
            role={activeTensions.length > 0 ? 'button' : undefined}
            tabIndex={activeTensions.length > 0 ? 0 : undefined}
            aria-expanded={activeTensions.length > 0 ? tensionExpanded : undefined}
            onClick={() => activeTensions.length > 0 && setTensionExpanded(v => !v)}
            onKeyDown={e => {
              if (activeTensions.length === 0) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTensionExpanded(v => !v);
              }
            }}
          >
            <span className={`status-icon ${activeTensions.length > 0 ? 'tension' : intents.length === 0 ? 'idle' : currentVersion ? 'done' : ''}`} />
            <span className="status-text">
              {activeTensions.length > 0 ? (
                <>
                  <strong>{activeTensions.length}</strong> 个分歧待你拍板 ·
                  AI 已给出调和方案
                </>
              ) : intents.length === 0 ? (
                <>还没有人发声。第一句话就能开始。</>
              ) : currentVersion ? (
                <>
                  <strong>{intents.length}</strong> 条意图,已合成为这版{TYPE_LABEL[project.type]}
                  <span className="prov-hint">
                    {' · '}
                    {traceMode ? '正在显示每块来自谁' : '把鼠标放卡片上,看哪些意图驱动了产物'}
                  </span>
                </>
              ) : (
                <>
                  <strong>{intents.length}</strong> 条意图,AI 正在合成…
                </>
              )}
            </span>
            {activeTensions.length > 0 && (
              <span
                className={`tension-toggle-chevron${tensionExpanded ? ' open' : ''}`}
                aria-hidden
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {tensionExpanded ? '收起' : '展开'}
              </span>
            )}
          </div>

          {activeTensions.length > 0 && tensionExpanded && (
            <div className="tension-stack">
              {activeTensions.map((t, i) => (
                <TensionCard
                  key={t.id}
                  projectId={project.id}
                  tension={t}
                  intentMap={intentById}
                  employeeMap={employeeById}
                  conflictMode={conflictMode}
                  onResolved={handleTensionResolved}
                  onDiscuss={handleDiscussTension}
                  defaultExpanded={i === 0}
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
              activeTensionCount={activeTensions.length}
              agentsReacting={agentsReacting}
              onSynthesisStart={() => {
                setIsSynthesizing(true);
                // 快照时 agent 已全部反应完毕，分界线位置与实际合成内容一致
                setSynthesisPendingIds(new Set(intents.map(i => i.id)));
              }}
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
            currentUser={currentUser}
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

      {(prefCandidates.length > 0 || agentLearningToasts.length > 0) && (
        <div className="pref-toast-stack">
          {/* Agent 学习通知 — 发布后短暂显示 */}
          {agentLearningToasts.map(t => (
            <div key={t.id} className={`agent-learn-toast${t.phase === 'done' ? ' done' : ''}`}>
              <span className={`agent-learn-icon${t.phase === 'learning' ? ' spinning' : ''}`}>
                {t.phase === 'learning' ? '⟳' : '⚡'}
              </span>
              <span className="agent-learn-text">
                {t.phase === 'learning'
                  ? `${t.name} 正在吸收本项目的决策偏好…`
                  : `${t.name} 已学习完成，偏好库已更新`}
              </span>
            </div>
          ))}
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

      {/* 历史讨论面板 */}
      {historyOpen && (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <div className="modal-panel history-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="历史讨论">
            <header className="modal-head">
              <h2 className="modal-title">历史讨论</h2>
              <p className="modal-sub">所有曾开启的讨论，包括已收敛的。</p>
            </header>
            <div className="modal-body history-list">
              {loadingHistory ? (
                <div className="history-empty">加载中…</div>
              ) : allThreads.length === 0 ? (
                <div className="history-empty">还没有任何讨论。</div>
              ) : allThreads.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className="history-row"
                  onClick={() => {
                    setHistoryOpen(false);
                    // 打开这条 thread 的抽屉
                    openDiscussionForThread(t);
                  }}
                >
                  <span className={`history-status-dot${t.status === 'resolved' ? ' resolved' : ''}`} />
                  <span className="history-row-text">
                    <span className="history-row-title">{t.title}</span>
                    <span className="history-row-meta">
                      {t.scope ? `${t.scope} · ` : ''}{t.status === 'resolved' ? '已收敛' : '进行中'}
                    </span>
                  </span>
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden style={{ width: 10, height: 10, flexShrink: 0, color: 'var(--text-4)' }}>
                    <path d="M3 2l4 3-4 3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
            <footer className="modal-foot">
              <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setHistoryOpen(false)}>关闭</button>
            </footer>
          </div>
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
        variant="evolution"
        eyebrow="组织进化"
        title="恭喜，你们的组织完成了一次进化"
        sub={
          <>
            从 <strong>{publishStats?.intents ?? intents.length}</strong> 条独立的判断,
            收敛为一份能上线的产物——
            <br />
            每条意图都活在结果里。
          </>
        }
        stats={[
          { num: publishStats?.intents ?? intents.length, label: 'Intent 全部命中' },
          { num: publishStats?.contributorCount ?? collaboratorsState.length, label: '位贡献者' },
          { num: publishStats?.consensusCount ?? 0, label: '次冲突共识' },
          { num: `v${publishStats?.versions ?? versionsTotal}`, label: '产物版本' },
        ]}
        onClose={() => setCelebrationOpen(false)}
      />

      <CelebrationModal
        open={consensusOpen}
        variant="consensus"
        eyebrow={`共识时刻 · 第 ${consensusStats?.nth ?? 1} 次`}
        title="团队达成了一次重要共识"
        sub={
          consensusStats ? (
            <>
              <strong>{consensusStats.partyAName}</strong> 与{' '}
              <strong>{consensusStats.partyBName}</strong> 从对立走向调和——
              <br />
              这次决策已写入产物的溯源。
            </>
          ) : (
            <>对立已经化解,产物会按新方案合成。</>
          )
        }
        stats={[
          { num: 1, label: '冲突化解' },
          { num: consensusStats?.contributorCount ?? 2, label: '位贡献者意图' },
          { num: `方案 ${consensusStats?.optionKey ?? 'A'}`, label: '入选' },
        ]}
        onClose={handleConsensusModalClose}
      />
    </div>
  );
}
