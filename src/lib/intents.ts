/**
 * Intent queries — 走本地 SQLite (lib/db.ts)。
 * Server-only。
 */

import { db, newId, nowISO } from './db';
import type {
  Intent,
  IntentType,
  IntentWeight,
  AuthorKind,
} from './types';

type IntentRow = {
  id: string;
  project_id: string;
  author_id: string;
  author_kind: string;
  statement: string;
  type: string;
  scope: string;
  weight: string;
  rationale: string | null;
  created_at: string;
  trigger_intent_id: string | null;
};

function rowToIntent(row: IntentRow): Intent {
  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    authorKind: row.author_kind as AuthorKind,
    statement: row.statement,
    type: row.type as IntentType,
    scope: row.scope,
    weight: row.weight as IntentWeight,
    rationale: row.rationale,
    createdAt: row.created_at,
    triggerIntentId: row.trigger_intent_id ?? null,
  };
}

export async function listIntentsByProject(
  projectId: string
): Promise<Intent[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM intents WHERE project_id = ? ORDER BY created_at ASC`
    )
    .all(projectId) as IntentRow[];
  return rows.map(rowToIntent);
}

export type CreateIntentInput = {
  projectId: string;
  authorId: string;
  authorKind: AuthorKind;
  statement: string;
  type?: IntentType;
  scope?: string;
  weight?: IntentWeight;
  rationale?: string | null;
  /** 哪条 Intent 触发了这一条 (Agent react 用)。null = 自然产生 */
  triggerIntentId?: string | null;
};

export async function createIntent(input: CreateIntentInput): Promise<Intent> {
  const id = newId();
  const now = nowISO();
  db()
    .prepare(
      `INSERT INTO intents
        (id, project_id, author_id, author_kind, statement, type, scope, weight, rationale, trigger_intent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.authorId,
      input.authorKind,
      input.statement,
      input.type ?? 'Goal',
      input.scope ?? 'global',
      input.weight ?? 'should',
      input.rationale ?? null,
      input.triggerIntentId ?? null,
      now
    );

  const row = db()
    .prepare('SELECT * FROM intents WHERE id = ?')
    .get(id) as IntentRow | undefined;
  if (!row) throw new Error('createIntent: insert succeeded but read failed');
  return rowToIntent(row);
}

/**
 * 计算一条 Intent 的「Agent 接话链长度」: 从这条往上回溯到 human 起点 (或停止追溯) 的跳数。
 *
 * - human Intent (无论 trigger): depth = 0
 * - agent Intent 但 triggerIntentId=null (manual speak 起点): depth = 0
 * - agent Intent + triggerIntentId 指向 human: depth = 1
 * - agent Intent + triggerIntentId 指向 agent (depth=1): depth = 2
 * - 超过深度上限或追到 null: 返回当前深度
 *
 * 用于 agent-react 决定要不要给 trigger 接话:
 *   计算 trigger 的 depth + 1, 如果 > MAX_CHAIN_DEPTH 直接 silent。
 */
export async function chainDepthOf(
  intentId: string,
  maxDepth = 8
): Promise<number> {
  let cursor: string | null = intentId;
  let depth = 0;
  while (cursor && depth < maxDepth) {
    const row = db()
      .prepare(
        `SELECT author_kind, trigger_intent_id FROM intents WHERE id = ?`
      )
      .get(cursor) as
      | { author_kind: string; trigger_intent_id: string | null }
      | undefined;
    if (!row) return depth;
    if (row.author_kind === 'human') return depth;
    if (!row.trigger_intent_id) return depth;
    depth += 1;
    cursor = row.trigger_intent_id;
  }
  return depth;
}

export async function getIntent(id: string): Promise<Intent | null> {
  const row = db()
    .prepare('SELECT * FROM intents WHERE id = ?')
    .get(id) as IntentRow | undefined;
  return row ? rowToIntent(row) : null;
}

export async function deleteIntent(
  id: string
): Promise<{ projectId: string } | null> {
  const conn = db();
  const row = conn
    .prepare('SELECT project_id FROM intents WHERE id = ?')
    .get(id) as { project_id: string } | undefined;
  if (!row) return null;
  conn.prepare('DELETE FROM intents WHERE id = ?').run(id);
  return { projectId: row.project_id };
}

/**
 * 给一组项目批量取最近的 Intent 摘要 (卡片预览用)。
 * 用一条 SQL 拉全部,在内存按 project_id 分组,避免 N+1。
 */
export async function summarizeIntentsForProjects(
  projectIds: string[]
): Promise<Map<string, { count: number; preview?: string }>> {
  const result = new Map<string, { count: number; preview?: string }>();
  if (projectIds.length === 0) return result;

  const placeholders = projectIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT project_id, statement
       FROM intents
       WHERE project_id IN (${placeholders})
       ORDER BY created_at DESC`
    )
    .all(...projectIds) as Array<{ project_id: string; statement: string }>;

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.project_id) ?? [];
    list.push(row.statement);
    grouped.set(row.project_id, list);
  }

  for (const id of projectIds) {
    const statements = grouped.get(id) ?? [];
    if (statements.length === 0) {
      result.set(id, { count: 0 });
      continue;
    }
    const preview = statements
      .slice(0, 3)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .join(' · ');
    result.set(id, { count: statements.length, preview });
  }

  return result;
}
