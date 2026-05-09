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

export type VersionMeta = Omit<Version, 'content'>;

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

/** 列表场景:不带 content,RSC payload 不会因为多个版本爆掉 */
export async function listVersionsMetadata(
  projectId: string
): Promise<VersionMeta[]> {
  const rows = db()
    .prepare(
      `SELECT id, project_id, format, intent_ids, created_at
       FROM versions
       WHERE project_id = ?
       ORDER BY created_at ASC`
    )
    .all(projectId) as Omit<VersionRow, 'content'>[];
  return rows.map(row => {
    let intentIds: string[] = [];
    try { intentIds = JSON.parse(row.intent_ids); } catch { /* ignore */ }
    return {
      id: row.id,
      projectId: row.project_id,
      format: row.format,
      intentIds,
      createdAt: row.created_at,
    };
  });
}

export async function getVersionById(
  versionId: string
): Promise<Version | null> {
  const row = db()
    .prepare(`SELECT * FROM versions WHERE id = ?`)
    .get(versionId) as VersionRow | undefined;
  return row ? rowToVersion(row) : null;
}

/**
 * 把指定 version 复制成新版本写入。等价于 demo 的"一键回滚":
 * 不删除历史,而是把目标版本作为最新版本再写一遍,留下完整轨迹。
 */
export async function rollbackTo(
  projectId: string,
  sourceVersionId: string
): Promise<Version> {
  const source = await getVersionById(sourceVersionId);
  if (!source || source.projectId !== projectId) {
    throw new Error('source version not found');
  }
  return createVersion({
    projectId,
    format: source.format,
    content: source.content,
    intentIds: source.intentIds,
  });
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
