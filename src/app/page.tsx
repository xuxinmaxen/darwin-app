/**
 * 工作台 (V1) — Server Component
 *
 * 拉项目 + Intent 摘要 + Claude/Supabase 状态,塞给 WorkspaceShell (Client)。
 * Shell 自己管搜索/过滤/快捷键。
 */

import { redirect } from 'next/navigation';
import { listProjects, listCollaboratorsByProjects } from '@/lib/projects';
import { summarizeIntentsForProjects } from '@/lib/intents';
import { listEmployees } from '@/lib/employees';
import { loadSidebarCounts } from '@/lib/sidebar-counts';
import { currentUser } from '@/lib/auth';
import type { Project } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import WorkspaceShell from '@/components/WorkspaceShell';

// 工作台读 DB,绝不能被 build-time 静态预渲染 —— 否则新建项目后看不到。
export const dynamic = 'force-dynamic';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

type Summary = { count: number; preview?: string };

async function safeLoad(): Promise<{
  projects: Project[];
  summaries: Record<string, Summary>;
  collaborators: Record<string, Employee[]>;
  employees: Employee[];
  error: string | null;
}> {
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    const projectIds = projects.map(p => p.id);
    const [summaryMap, collabMap, employees] = await Promise.all([
      summarizeIntentsForProjects(projectIds),
      listCollaboratorsByProjects(projectIds),
      listEmployees(DEMO_OWNER_ID),
    ]);
    const summaries: Record<string, Summary> = {};
    for (const [id, s] of summaryMap) summaries[id] = s;
    const collaborators: Record<string, Employee[]> = {};
    for (const [id, list] of collabMap) collaborators[id] = list;
    return { projects, summaries, collaborators, employees, error: null };
  } catch (err) {
    return {
      projects: [],
      summaries: {},
      collaborators: {},
      employees: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function WorkspacePage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const [{ projects, summaries, collaborators, employees, error: dbError }, counts] =
    await Promise.all([safeLoad(), loadSidebarCounts(DEMO_OWNER_ID)]);

  return (
    <WorkspaceShell
      projects={projects}
      summaries={summaries}
      collaborators={collaborators}
      employees={employees}
      dbError={dbError}
      memoryCount={counts.memoryCount}
      employeesCount={counts.employeesCount}
      currentUser={{
        id: user.id,
        name: user.name,
        role: user.role,
        cls: user.cls,
        short: user.short,
      }}
    />
  );
}
