/**
 * Tension queries — 走本地 SQLite (lib/db.ts)
 *
 * Tension = 同 scope 下两条 must Intent 语义对立时, AI 检测出的协作事件。
 *   - 不是错误, 是事件
 *   - 必须显性化、可讨论、可仲裁、可留痕
 *
 * Server-only。
 */

import { db, newId, nowISO } from './db';
import type {
  Tension,
  TensionOption,
  TensionResolution,
  TensionStatus,
  TensionVariant,
} from './types';

type TensionRow = {
  id: string;
  project_id: string;
  scope: string;
  intent_ids: string;       // JSON
  variant: string;
  status: string;
  options: string;          // JSON
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
};

function rowToTension(row: TensionRow): Tension {
  let intentIds: string[] = [];
  let options: TensionOption[] = [];
  let resolution: TensionResolution | null = null;
  try { intentIds = JSON.parse(row.intent_ids); } catch { /* ignore */ }
  try { options = JSON.parse(row.options); } catch { /* ignore */ }
  if (row.resolution) {
    try { resolution = JSON.parse(row.resolution); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    intentIds,
    variant: row.variant as TensionVariant,
    status: row.status as TensionStatus,
    options,
    resolution,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  };
}

// ─── List / Get ────────────────────────────────────────────

export async function listTensions(projectId: string): Promise<Tension[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM tensions WHERE project_id = ? ORDER BY created_at DESC`
    )
    .all(projectId) as TensionRow[];
  return rows.map(rowToTension);
}

export async function listActiveTensions(projectId: string): Promise<Tension[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM tensions
       WHERE project_id = ? AND status = 'active'
       ORDER BY created_at ASC`
    )
    .all(projectId) as TensionRow[];
  return rows.map(rowToTension);
}

export async function getTension(id: string): Promise<Tension | null> {
  const row = db()
    .prepare(`SELECT * FROM tensions WHERE id = ?`)
    .get(id) as TensionRow | undefined;
  return row ? rowToTension(row) : null;
}

/**
 * 同 scope + 同 intentIds 集合的 active tension 是否已存在 ── 用于去重。
 * 检测器会被 fan-out 多次触发, 不能重复写。
 */
export async function findActiveTensionFor(
  projectId: string,
  scope: string,
  intentIds: string[]
): Promise<Tension | null> {
  const sortedIds = [...intentIds].sort();
  const fingerprint = sortedIds.join(',');
  const rows = db()
    .prepare(
      `SELECT * FROM tensions
       WHERE project_id = ? AND scope = ? AND status = 'active'`
    )
    .all(projectId, scope) as TensionRow[];
  for (const row of rows) {
    let ids: string[] = [];
    try { ids = JSON.parse(row.intent_ids); } catch { /* ignore */ }
    if ([...ids].sort().join(',') === fingerprint) {
      return rowToTension(row);
    }
  }
  return null;
}

// ─── Create ────────────────────────────────────────────────

export type CreateTensionInput = {
  projectId: string;
  scope: string;
  intentIds: string[];
  variant: TensionVariant;
  options: TensionOption[];
};

export async function createTension(
  input: CreateTensionInput
): Promise<Tension> {
  const id = newId();
  const now = nowISO();
  db()
    .prepare(
      `INSERT INTO tensions
        (id, project_id, scope, intent_ids, variant, status, options, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.scope,
      JSON.stringify(input.intentIds),
      input.variant,
      JSON.stringify(input.options),
      now
    );
  return {
    id,
    projectId: input.projectId,
    scope: input.scope,
    intentIds: input.intentIds,
    variant: input.variant,
    status: 'active',
    options: input.options,
    resolution: null,
    createdAt: now,
    resolvedAt: null,
  };
}

// ─── Resolve ───────────────────────────────────────────────

export type ResolveTensionInput = {
  tensionId: string;
  selectedOptionKey: string;
  decidedBy: string[];
  threadId?: string | null;
};

export async function resolveTension(
  input: ResolveTensionInput
): Promise<Tension | null> {
  const existing = await getTension(input.tensionId);
  if (!existing) return null;
  if (existing.status === 'resolved') return existing;
  const now = nowISO();
  const resolution: TensionResolution = {
    selectedOptionKey: input.selectedOptionKey,
    decidedBy: input.decidedBy,
    decidedAt: now,
    threadId: input.threadId ?? null,
  };
  db()
    .prepare(
      `UPDATE tensions
       SET status = 'resolved', resolution = ?, resolved_at = ?
       WHERE id = ?`
    )
    .run(JSON.stringify(resolution), now, input.tensionId);
  return getTension(input.tensionId);
}
