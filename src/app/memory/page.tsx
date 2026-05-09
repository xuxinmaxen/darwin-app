/**
 * 团队记忆 — Server Component
 *
 * 拉 prefs / agent learning / timeline 后塞给 MemoryShell。
 */

import { listProjects } from '@/lib/projects';
import {
  listPrefs,
  listAgentLearning,
  listMemoryTimeline,
} from '@/lib/team-memory';
import MemoryShell from '@/components/MemoryShell';

export const dynamic = 'force-dynamic';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export default async function MemoryPage() {
  const [prefs, agents, timeline, projects] = await Promise.all([
    listPrefs(DEMO_OWNER_ID),
    listAgentLearning(DEMO_OWNER_ID),
    listMemoryTimeline(DEMO_OWNER_ID),
    listProjects(DEMO_OWNER_ID).catch(() => []),
  ]);

  return (
    <MemoryShell
      initialPrefs={prefs}
      agents={agents}
      timeline={timeline}
      projectsCount={projects.length}
    />
  );
}
