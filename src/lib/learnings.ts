/**
 * Agent 学习沉淀 — DB 层。
 *
 * 数据形态: 一个 (employee_id, project_id) 一条记录, 由 publish hook 写入。
 * 同项目再发布 → UPSERT 刷新, 不堆历史 (UNIQUE(employee_id, project_id) 约束 + onConflict)。
 *
 * highlights 在 DB 里以 JSON 字符串存 (跟 employees.tags_json 同款), 读出来 parse。
 */

import { db, assertOk, newId, nowISO } from './db';
import type { EmployeeLearning, MemoryEvent } from './types';

type LearningRow = {
  id: string;
  employee_id: string;
  project_id: string;
  summary: string;
  highlights: string | null;
  created_at: string;
  updated_at: string;
};

function rowToLearning(row: LearningRow): EmployeeLearning {
  let highlights: string[] = [];
  if (row.highlights) {
    try {
      const parsed = JSON.parse(row.highlights);
      if (Array.isArray(parsed)) {
        highlights = parsed.filter((s: unknown): s is string => typeof s === 'string');
      }
    } catch {
      /* 损坏的 JSON 退化为空数组, 不致命 */
    }
  }
  return {
    id: row.id,
    employeeId: row.employee_id,
    projectId: row.project_id,
    summary: row.summary,
    highlights,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type UpsertLearningInput = {
  employeeId: string;
  projectId: string;
  summary: string;
  highlights: string[];
};

/**
 * 写入或刷新一条 learning。
 *
 * 用 select-then-insert/update 而不是 Supabase upsert: upsert 会用新 payload 全列覆盖,
 * 把原始的 created_at (= agent 第一次学这个项目的时间) 抹掉。这里手动保留 created_at,
 * 只刷 summary / highlights / updated_at。
 *
 * 并发风险: 两个 publish 几乎同时打 → 都 select 不到 → 都 insert → 第二个被 UNIQUE 约束打掉,
 * 抛出来由调用方的 Promise.allSettled 兜住。
 */
export async function upsertLearning(input: UpsertLearningInput): Promise<EmployeeLearning> {
  const highlightsJson = JSON.stringify(input.highlights);
  const now = nowISO();

  const { data: existing, error: selErr } = await db()
    .from('employee_learnings')
    .select('id, created_at')
    .eq('employee_id', input.employeeId)
    .eq('project_id', input.projectId)
    .maybeSingle();
  if (selErr) throw new Error(`upsertLearning select: ${selErr.message}`);

  if (existing) {
    const { error: updErr } = await db()
      .from('employee_learnings')
      .update({ summary: input.summary, highlights: highlightsJson, updated_at: now })
      .eq('id', (existing as { id: string }).id);
    if (updErr) throw new Error(`upsertLearning update: ${updErr.message}`);
  } else {
    const { error: insErr } = await db()
      .from('employee_learnings')
      .insert({
        id: newId(),
        employee_id: input.employeeId,
        project_id: input.projectId,
        summary: input.summary,
        highlights: highlightsJson,
        created_at: now,
        updated_at: now,
      });
    if (insErr) throw new Error(`upsertLearning insert: ${insErr.message}`);
  }

  const { data, error: readErr } = await db()
    .from('employee_learnings')
    .select('*')
    .eq('employee_id', input.employeeId)
    .eq('project_id', input.projectId)
    .maybeSingle();
  if (readErr) throw new Error(`upsertLearning read-back: ${readErr.message}`);
  if (!data) throw new Error('upsertLearning: row missing after write');
  return rowToLearning(data as LearningRow);
}

/**
 * 拿一个 owner 名下所有 learning, 联 employees + projects 拼出 timeline 用的 MemoryEvent[]。
 *
 * filter 是 projects.owner_id (跟 listMemoryTimeline 的 tension 那一支保持一致), 不是 employees.owner_id —
 * 一个项目里可能有别的 owner 的 agent 协作, 学习应该挂在项目所有者的 timeline 上。
 */
export async function listLearningsAsEvents(ownerId: string, limit = 30): Promise<MemoryEvent[]> {
  // Supabase PostgREST embed: employee_learnings + employees + projects
  // projects(name, owner_id) — filter `.eq('projects.owner_id', ownerId)` 走 inner join
  const { data, error } = await db()
    .from('employee_learnings')
    .select(`
      id, employee_id, project_id, summary, highlights, created_at,
      employees!inner ( name, role, cls, kind, linked_human_id ),
      projects!inner ( name, owner_id )
    `)
    .eq('projects.owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listLearningsAsEvents: ${error.message}`);

  type EmbedRow = {
    id: string;
    employee_id: string;
    project_id: string;
    summary: string;
    highlights: string | null;
    created_at: string;
    employees: { name: string; role: string; cls: string; kind: string; linked_human_id: string | null }
            | { name: string; role: string; cls: string; kind: string; linked_human_id: string | null }[]
            | null;
    projects: { name: string; owner_id: string } | { name: string; owner_id: string }[] | null;
  };

  const events: MemoryEvent[] = [];
  for (const row of (data ?? []) as unknown as EmbedRow[]) {
    const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const proj = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    if (!emp || !proj) continue;

    let highlights: string[] = [];
    if (row.highlights) {
      try {
        const p = JSON.parse(row.highlights);
        if (Array.isArray(p)) highlights = p.filter((s: unknown): s is string => typeof s === 'string');
      } catch { /* ignore */ }
    }

    const isDigital = !!emp.linked_human_id;
    const subjectKind = isDigital ? '数字分身' : 'Agent';
    // summary 已是"X 学到 ..."风格, body 直接放; 加粗 agent 名让它跟 timeline 其它条目视觉一致
    const body = row.summary.startsWith(`**${emp.name}**`) || row.summary.startsWith(emp.name)
      ? row.summary
      : `**${emp.name}** ${row.summary}`;
    const metaParts = [`${subjectKind} · 项目「${proj.name}」`];
    if (highlights.length > 0) metaParts.push(highlights.slice(0, 2).join(' · '));
    events.push({
      id: `learning:${row.id}`,
      kind: 'learning',
      body,
      meta: metaParts.join(' · '),
      date: row.created_at,
      projectId: row.project_id,
    });
  }
  return events;
}

/** 直接读 — 主要给"员工管理页展示某 agent 的学习清单"留口子, 本期 UI 不用但接口先有 */
export async function listLearningsByEmployee(employeeId: string, limit = 50): Promise<EmployeeLearning[]> {
  const result = await db()
    .from('employee_learnings')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return assertOk(result).map(row => rowToLearning(row as LearningRow));
}
