/**
 * 工作台 (V1) — Server Component
 *
 * 拉项目 + Intent 摘要 + Claude/Supabase 状态,塞给 WorkspaceShell (Client)。
 * Shell 自己管搜索/过滤/快捷键。
 */

import { describeClaudeConfig } from '@/lib/claude';
import { listProjects } from '@/lib/projects';
import { summarizeIntentsForProjects } from '@/lib/intents';
import type { Project } from '@/lib/types';
import WorkspaceShell from '@/components/WorkspaceShell';

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
  const claude = describeClaudeConfig();
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { projects, summaries, error: dbError } = supabaseConfigured
    ? await safeLoad()
    : {
        projects: [] as Project[],
        summaries: {} as Record<string, Summary>,
        error: null,
      };

  return (
    <WorkspaceShell
      projects={projects}
      summaries={summaries}
      supabaseConfigured={supabaseConfigured}
      claudeReady={claude.hasKey}
      claudeModel={claude.modelDefault}
      dbError={dbError}
    />
  );
}
