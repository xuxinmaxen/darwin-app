/**
 * Sidebar 三个 nav 的 count: projects / memory(prefs) / employees。
 * 三个页面 server component 都调它,sidebar 显示一致。
 */

import { listProjects } from './projects';
import { listEmployees } from './employees';
import { listPrefs } from './team-memory';

export type SidebarCounts = {
  projectsCount: number;
  memoryCount: number;
  employeesCount: number;
};

export async function loadSidebarCounts(
  ownerId: string
): Promise<SidebarCounts> {
  try {
    const [projects, prefs, employees] = await Promise.all([
      listProjects(ownerId),
      listPrefs(ownerId),
      listEmployees(ownerId),
    ]);
    return {
      projectsCount: projects.length,
      memoryCount: prefs.length,
      // 数字分身也是员工, 但 /employees 主网格只显示真人 + 独立 Agent。
      // sidebar 数字按 "用户能看到的卡片数" 算, 跟主网格保持一致。
      employeesCount: employees.filter(
        e => !(e.kind === 'agent' && e.linkedHumanId)
      ).length,
    };
  } catch {
    return { projectsCount: 0, memoryCount: 0, employeesCount: 0 };
  }
}
