/**
 * 团队脉搏 — 首页 Pulse 视图的聚合层。
 *
 * 跟"项目管理"的 grid view 不同, Pulse 看的是"团队此刻在想什么":
 *   - 哪些项目还在协作中, 最新一条 intent 是什么
 *   - 哪些张力还没消化 (跨项目 flatten)
 *   - 最近团队记忆 (沉淀事件)
 *
 * Server-only, 在 RSC 里 await 调一次, snapshot 给页面渲染。
 *
 * N+1 注意: 遍历 active projects 各调 listIntentsByProject + listActiveTensions,
 * project 通常 ≤10, 总 query 数 < 25, 单次访问 < 1s, 可接受。V2 优化用单 join SQL。
 */

import type { MemoryEvent } from './types';
import { listProjects } from './projects';
import { listIntentsByProject } from './intents';
import { listActiveTensions } from './tensions';
import { listMemoryTimeline } from './team-memory';
import { listEmployees } from './employees';

export type PulseActiveProject = {
  projectId: string;
  name: string;
  status: string;
  latestIntent: {
    statement: string;
    authorName: string;
    authorCls: string;
    authorKind: 'human' | 'agent';
    createdAt: string;
  } | null;
  intentsCount: number;
  unresolvedTensionsCount: number;
  /** 最近活动时间 — 取 latestIntent.createdAt or project.updatedAt 较新者 */
  lastActiveAt: string;
};

export type PulseUnresolvedTension = {
  tensionId: string;
  projectId: string;
  projectName: string;
  scope: string;
  variant: string;
  createdAt: string;
  ageMinutes: number;
};

export type TeamPulse = {
  activeProjects: PulseActiveProject[];
  unresolvedTensions: PulseUnresolvedTension[];
  recentEvents: MemoryEvent[];
};

const MAX_ACTIVE_PROJECTS = 6;
const MAX_TENSIONS = 8;
const RECENT_EVENTS_LIMIT = 6;

export async function getTeamPulse(ownerId: string): Promise<TeamPulse> {
  // 1. 拉所有项目, 留下未发布的 (协作/对立/收敛/草稿都算活跃)
  const allProjects = await listProjects(ownerId);
  const activeProjects = allProjects.filter(p => p.status !== 'published');

  // 2. 拉员工字典 (为了 latestIntent.author 解析名字 / cls)
  const employees = await listEmployees(ownerId).catch(() => []);
  const empById = new Map(employees.map(e => [e.id, e]));

  // 3. 并行: 每个活跃项目拉 intents + active tensions
  const projectDetails = await Promise.all(
    activeProjects.map(async p => {
      const [intents, tensions] = await Promise.all([
        listIntentsByProject(p.id).catch(() => []),
        listActiveTensions(p.id).catch(() => []),
      ]);
      const latest = intents.length > 0 ? intents[intents.length - 1] : null;
      const author = latest ? empById.get(latest.authorId) : null;
      return { project: p, intents, tensions, latest, author };
    })
  );

  // 4. 拼 activeProjects, 按"最近活动"排序
  const pulseProjects: PulseActiveProject[] = projectDetails.map(d => {
    const latest = d.latest;
    const lastActiveAt = latest
      ? (latest.createdAt > d.project.updatedAt ? latest.createdAt : d.project.updatedAt)
      : d.project.updatedAt;
    return {
      projectId: d.project.id,
      name: d.project.name,
      status: d.project.status,
      latestIntent: latest && d.author
        ? {
            statement: latest.statement,
            authorName: d.author.name,
            authorCls: d.author.cls,
            authorKind: latest.authorKind,
            createdAt: latest.createdAt,
          }
        : null,
      intentsCount: d.intents.length,
      unresolvedTensionsCount: d.tensions.length,
      lastActiveAt,
    };
  });
  pulseProjects.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
  const trimmedProjects = pulseProjects.slice(0, MAX_ACTIVE_PROJECTS);

  // 5. flatten 所有 unresolved tensions, 按创建时间倒序
  const now = Date.now();
  const projectNameById = new Map(activeProjects.map(p => [p.id, p.name]));
  const allTensions: PulseUnresolvedTension[] = [];
  for (const d of projectDetails) {
    for (const t of d.tensions) {
      allTensions.push({
        tensionId: t.id,
        projectId: d.project.id,
        projectName: projectNameById.get(d.project.id) ?? d.project.name,
        scope: t.scope,
        variant: t.variant,
        createdAt: t.createdAt,
        ageMinutes: Math.max(0, Math.round((now - new Date(t.createdAt).getTime()) / 60_000)),
      });
    }
  }
  allTensions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const trimmedTensions = allTensions.slice(0, MAX_TENSIONS);

  // 6. recent events 直接复用 timeline
  const recentEvents = await listMemoryTimeline(ownerId, RECENT_EVENTS_LIMIT).catch(() => []);

  return {
    activeProjects: trimmedProjects,
    unresolvedTensions: trimmedTensions,
    recentEvents,
  };
}
