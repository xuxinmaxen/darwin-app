/**
 * 员工管理页 — Server Component, 拉数据后塞给 EmployeesShell。
 */

import { listEmployees } from '@/lib/employees';
import { loadSidebarCounts } from '@/lib/sidebar-counts';
import EmployeesShell from '@/components/EmployeesShell';

export const dynamic = 'force-dynamic';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export default async function EmployeesPage() {
  const [employees, counts] = await Promise.all([
    listEmployees(DEMO_OWNER_ID),
    loadSidebarCounts(DEMO_OWNER_ID),
  ]);

  return (
    <EmployeesShell
      initialEmployees={employees}
      projectsCount={counts.projectsCount}
      memoryCount={counts.memoryCount}
      employeesCount={counts.employeesCount}
    />
  );
}
