/**
 * 团队记忆 — Server Component
 *
 * 拉 prefs / agent learning / timeline 后塞给 MemoryShell。
 */

import { redirect } from 'next/navigation';
import {
  listPrefs,
  listAgentLearning,
  listMemoryTimeline,
} from '@/lib/team-memory';
import { loadSidebarCounts } from '@/lib/sidebar-counts';
import { currentUser } from '@/lib/auth';
import MemoryShell from '@/components/MemoryShell';

export const dynamic = 'force-dynamic';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export default async function MemoryPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const [prefs, agents, timeline, counts] = await Promise.all([
    listPrefs(DEMO_OWNER_ID),
    listAgentLearning(DEMO_OWNER_ID),
    listMemoryTimeline(DEMO_OWNER_ID),
    loadSidebarCounts(DEMO_OWNER_ID),
  ]);

  return (
    <MemoryShell
      initialPrefs={prefs}
      agents={agents}
      timeline={timeline}
      projectsCount={counts.projectsCount}
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
