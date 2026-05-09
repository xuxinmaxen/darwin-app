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
};

export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const id = newId();
  const now = nowISO();
  db()
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
  const created = await getProject(id);
  if (!created) throw new Error('createProject: insert succeeded but read failed');
  return created;
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
