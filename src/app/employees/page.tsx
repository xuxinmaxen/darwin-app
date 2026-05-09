/**
 * 员工管理页 — Server Component, 拉数据后塞给 EmployeesShell。
 */

import { listEmployees } from '@/lib/employees';
import { listProjects } from '@/lib/projects';
import EmployeesShell from '@/components/EmployeesShell';

export const dynamic = 'force-dynamic';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export default async function EmployeesPage() {
  const [employees, projects] = await Promise.all([
    listEmployees(DEMO_OWNER_ID),
    listProjects(DEMO_OWNER_ID).catch(() => []),
  ]);

  return (
    <EmployeesShell
      initialEmployees={employees}
      projectsCount={projects.length}
    />
  );
}
