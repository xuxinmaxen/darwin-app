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
  publishedAt: string | null;
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
  published_at: string | null;
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
    publishedAt: row.published_at ?? null,
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
      `SELECT id, project_id, format, intent_ids, created_at, published_at
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
      publishedAt: row.published_at ?? null,
    };
  });
}

/**
 * 把指定 version 标记为已发布。
 * 同一个项目同一时间只允许一个 published version (后发布的覆盖前一个)。
 */
export async function publishVersion(
  projectId: string,
  versionId: string
): Promise<Version> {
  const target = await getVersionById(versionId);
  if (!target || target.projectId !== projectId) {
    throw new Error('version not found');
  }
  const now = nowISO();
  const tx = db().transaction(() => {
    db()
      .prepare(`UPDATE versions SET published_at = NULL WHERE project_id = ?`)
      .run(projectId);
    db()
      .prepare(`UPDATE versions SET published_at = ? WHERE id = ?`)
      .run(now, versionId);
  });
  tx();
  return { ...target, publishedAt: now };
}

export async function getPublishedVersion(
  projectId: string
): Promise<Version | null> {
  const row = db()
    .prepare(
      `SELECT * FROM versions
       WHERE project_id = ? AND published_at IS NOT NULL
       ORDER BY published_at DESC LIMIT 1`
    )
    .get(projectId) as VersionRow | undefined;
  return row ? rowToVersion(row) : null;
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
    publishedAt: null,
  };
}
