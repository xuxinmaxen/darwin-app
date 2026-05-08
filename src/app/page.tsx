/**
 * 工作台 (V1) — Server Component
 *
 * 拉项目 + Intent 摘要 + Claude/Supabase 状态,塞给 WorkspaceShell (Client)。
 * Shell 自己管搜索/过滤/快捷键。
 */

import { describeLLM } from '@/lib/llm';
import { listProjects } from '@/lib/projects';
import { summarizeIntentsForProjects } from '@/lib/intents';
import type { Project } from '@/lib/types';
import WorkspaceShell from '@/components/WorkspaceShell';

// 工作台读 DB,绝不能被 build-time 静态预渲染 —— 否则新建项目后看不到。
export const dynamic = 'force-dynamic';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

type Summary = { count: number; preview?: string };

async function safeLoad(): Promise<{
  projects: Project[];
  summaries: Record<string, Summary>;
  error: string | null;
}> {
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    const map = await summarizeIntentsForProjects(projects.map(p => p.id));
    const summaries: Record<string, Summary> = {};
    for (const [id, s] of map) summaries[id] = s;
    return { projects, summaries, error: null };
  } catch (err) {
    return {
      projects: [],
      summaries: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function WorkspacePage() {
  const llm = describeLLM();
  const { projects, summaries, error: dbError } = await safeLoad();

  return (
    <WorkspaceShell
      projects={projects}
      summaries={summaries}
      supabaseConfigured={true}
      claudeReady={llm.hasKey}
      claudeModel={llm.provider ? `${llm.provider} · ${llm.model}` : '未配置'}
      dbError={dbError}
    />
  );
}
