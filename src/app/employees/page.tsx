/**
 * 员工管理 — V2 占位页 (Server Component)
 */

import { listProjects } from '@/lib/projects';
import V2StubShell from '@/components/V2StubShell';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export default async function EmployeesPage() {
  let count = 0;
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    count = projects.length;
  } catch {
    // ignore
  }

  return (
    <V2StubShell
      active="employees"
      projectsCount={count}
      eyebrow="员工管理"
      title="公司员工管理"
      description="Agent 员工以人设驱动，可以像同事一样加入项目，主动贡献 Intent。"
      preview="V2 上线后，这里会管理：真实员工 (徐鑫 / 李明 / 王芳…) · Agent 员工 (Atlas / Lyra…) 的人设、技能、加入项目记录。Agent 会按人设贡献 Intent，参与冲突调和。"
    />
  );
}
