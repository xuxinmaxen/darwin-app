/**
 * Version queries (lib/db.ts)。
 *
 * Version = 一次合成的产物快照 (HTML 字符串 / Markdown / etc.)。
 * Server-only。
 */

import { db, newId, nowISO } from './db';

export type Version = {
  id: string;
  projectId: string;
  format: string;
  content: string;
  intentIds: string[];
  createdAt: string;
  source?: 'llm' | 'template';
};

type VersionRow = {
  id: string;
  project_id: string;
  format: string;
  content: string;
  intent_ids: string;
  created_at: string;
};

function rowToVersion(row: VersionRow): Version {
  let intentIds: string[] = [];
  try {
    intentIds = JSON.parse(row.intent_ids);
  } catch {
    intentIds = [];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    format: row.format,
    content: row.content,
    intentIds,
    createdAt: row.created_at,
  };
}

export async function getLatestVersion(
  projectId: string
): Promise<Version | null> {
  const row = db()
    .prepare(
      `SELECT * FROM versions
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(projectId) as VersionRow | undefined;
  return row ? rowToVersion(row) : null;
}

export async function listVersions(projectId: string): Promise<Version[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM versions
       WHERE project_id = ?
       ORDER BY created_at DESC`
    )
    .all(projectId) as VersionRow[];
  return rows.map(rowToVersion);
}

export async function countVersions(projectId: string): Promise<number> {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM versions WHERE project_id = ?`)
    .get(projectId) as { n: number };
  return row.n;
}

export type CreateVersionInput = {
  projectId: string;
  format: string;
  content: string;
  intentIds: string[];
};

export async function createVersion(
  input: CreateVersionInput
): Promise<Version> {
  const id = newId();
  const now = nowISO();
  db()
    .prepare(
      `INSERT INTO versions
        (id, project_id, format, content, intent_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.format,
      input.content,
      JSON.stringify(input.intentIds),
      now
    );
  return {
    id,
    projectId: input.projectId,
    format: input.format,
    content: input.content,
    intentIds: input.intentIds,
    createdAt: now,
  };
}
