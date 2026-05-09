/**
 * Project queries — 走本地 SQLite (lib/db.ts)。
 *
 * Server-only。永远不要从 Client Component 引。
 */

import { db, newId, nowISO } from './db';
import type {
  Project,
  ProjectType,
  ConflictMode,
  ProjectStatus,
} from './types';
import type { Employee } from './employees';

// ─── DB row → Project shape ────────────────────────────────

type ProjectRow = {
  id: string;
  name: string;
  type: string;
  background: string | null;
  conflict_mode: string;
  status: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProjectType,
    background: row.background,
    conflictMode: row.conflict_mode as ConflictMode,
    status: row.status as ProjectStatus,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Queries ───────────────────────────────────────────────

export async function listProjects(ownerId?: string): Promise<Project[]> {
  const conn = db();
  const sql = ownerId
    ? `SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC`
    : `SELECT * FROM projects ORDER BY updated_at DESC`;
  const rows = (
    ownerId ? conn.prepare(sql).all(ownerId) : conn.prepare(sql).all()
  ) as ProjectRow[];
  return rows.map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const row = db()
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export type CreateProjectInput = {
  name: string;
  type: ProjectType;
  background?: string | null;
  conflictMode?: ConflictMode;
  ownerId: string;
  /** 额外协作者 (owner 自动加入,不需要重复传) */
  collaboratorIds?: string[];
};

export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const id = newId();
  const now = nowISO();
  // owner 默认是协作者; 去重后插
  const allCollabs = Array.from(
    new Set([input.ownerId, ...(input.collaboratorIds ?? [])])
  );
  const conn = db();
  const tx = conn.transaction(() => {
    conn
      .prepare(
        `INSERT INTO projects (id, name, type, background, conflict_mode, status, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.type,
        input.background ?? null,
        input.conflictMode ?? 'discuss',
        input.ownerId,
        now,
        now
      );
    const insertCollab = conn.prepare(
      `INSERT OR IGNORE INTO project_collaborators (project_id, employee_id, added_at)
       VALUES (?, ?, ?)`
    );
    for (const empId of allCollabs) {
      insertCollab.run(id, empId, now);
    }
  });
  tx();
  const created = await getProject(id);
  if (!created) throw new Error('createProject: insert succeeded but read failed');
  return created;
}

// ─── Collaborators ─────────────────────────────────────────

type EmployeeRow = {
  id: string;
  kind: 'human' | 'agent';
  name: string;
  short: string;
  role: string;
  email: string | null;
  persona: string | null;
  cls: string;
  linked_human_id: string | null;
  is_online: number;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    short: row.short,
    role: row.role,
    email: row.email,
    persona: row.persona,
    cls: row.cls,
    linkedHumanId: row.linked_human_id ?? null,
    isOnline: row.is_online !== 0,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCollaborators(projectId: string): Promise<Employee[]> {
  const rows = db()
    .prepare(
      `SELECT e.* FROM employees e
       JOIN project_collaborators pc ON pc.employee_id = e.id
       WHERE pc.project_id = ?
       ORDER BY pc.added_at ASC`
    )
    .all(projectId) as EmployeeRow[];
  return rows.map(rowToEmployee);
}

/** 批量: 给一组 projectId 一次性拉所有 collaborators, 返回 Map<projectId, Employee[]> */
export async function listCollaboratorsByProjects(
  projectIds: string[]
): Promise<Map<string, Employee[]>> {
  const result = new Map<string, Employee[]>();
  if (projectIds.length === 0) return result;
  const placeholders = projectIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT pc.project_id AS pid, e.* FROM employees e
       JOIN project_collaborators pc ON pc.employee_id = e.id
       WHERE pc.project_id IN (${placeholders})
       ORDER BY pc.added_at ASC`
    )
    .all(...projectIds) as (EmployeeRow & { pid: string })[];
  for (const row of rows) {
    const list = result.get(row.pid) ?? [];
    list.push(rowToEmployee(row));
    result.set(row.pid, list);
  }
  for (const id of projectIds) {
    if (!result.has(id)) result.set(id, []);
  }
  return result;
}

export async function setCollaborators(
  projectId: string,
  ownerId: string,
  collaboratorIds: string[]
): Promise<void> {
  const all = Array.from(new Set([ownerId, ...collaboratorIds]));
  const now = nowISO();
  const conn = db();
  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM project_collaborators WHERE project_id = ?`).run(projectId);
    const ins = conn.prepare(
      `INSERT OR IGNORE INTO project_collaborators (project_id, employee_id, added_at)
       VALUES (?, ?, ?)`
    );
    for (const empId of all) ins.run(projectId, empId, now);
  });
  tx();
}

export async function deleteProject(id: string): Promise<void> {
  db().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export type UpdateProjectInput = {
  name?: string;
  background?: string | null;
  status?: ProjectStatus;
  conflictMode?: ConflictMode;
};

export async function updateProject(
  id: string,
  input: UpdateProjectInput
): Promise<Project> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.background !== undefined) {
    fields.push('background = ?');
    values.push(input.background);
  }
  if (input.status !== undefined) {
    fields.push('status = ?');
    values.push(input.status);
  }
  if (input.conflictMode !== undefined) {
    fields.push('conflict_mode = ?');
    values.push(input.conflictMode);
  }
  fields.push('updated_at = ?');
  values.push(nowISO());

  values.push(id);
  db()
    .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);

  const updated = await getProject(id);
  if (!updated) throw new Error(`updateProject(${id}): row not found after update`);
  return updated;
}

/** 项目从 draft 跳到 collaborating 的轻量 hook —— 写第一条 Intent 时调一下。 */
export async function bumpToCollaborating(id: string): Promise<void> {
  db()
    .prepare(
      `UPDATE projects
       SET status = 'collaborating', updated_at = ?
       WHERE id = ? AND status = 'draft'`
    )
    .run(nowISO(), id);
}

export async function markPublished(id: string): Promise<void> {
  db()
    .prepare(
      `UPDATE projects
       SET status = 'published', updated_at = ?
       WHERE id = ?`
    )
    .run(nowISO(), id);
}
