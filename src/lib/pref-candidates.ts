/**
 * Pref Candidate (团队共识候选) — tension 解决后, LLM 从决议 + 讨论
 * 提取一条"团队共识候选项", 让团队点 "沉淀 / 弃" 决定要不要进 team_prefs。
 *
 * 设计要点:
 *   - 候选不是共识。沉淀必须由人 (或团队) 显性确认。
 *   - 候选不重复: 同一 tension_id 已有 pending/accepted 候选 → 不再产生。
 *   - 弃用候选保留为 dismissed (不删), 便于以后看"团队拒绝过什么"。
 *
 * Server-only。
 */

import { db, newId, nowISO } from './db';
import type { PrefCandidate, PrefCandidateStatus, TeamPrefIconKey } from './types';

type Row = {
  id: string;
  owner_id: string;
  project_id: string;
  tension_id: string | null;
  thread_id: string | null;
  icon_key: string;
  category: string;
  body: string;
  source_hint: string | null;
  status: string;
  accepted_pref_id: string | null;
  created_at: string;
  updated_at: string;
};

function rowToCandidate(row: Row): PrefCandidate {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    tensionId: row.tension_id,
    threadId: row.thread_id,
    iconKey: row.icon_key as TeamPrefIconKey,
    category: row.category,
    body: row.body,
    sourceHint: row.source_hint,
    status: row.status as PrefCandidateStatus,
    acceptedPrefId: row.accepted_pref_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPendingCandidates(
  projectId: string
): Promise<PrefCandidate[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM pref_candidates
       WHERE project_id = ? AND status = 'pending'
       ORDER BY created_at ASC`
    )
    .all(projectId) as Row[];
  return rows.map(rowToCandidate);
}

export async function getCandidate(id: string): Promise<PrefCandidate | null> {
  const row = db()
    .prepare(`SELECT * FROM pref_candidates WHERE id = ?`)
    .get(id) as Row | undefined;
  return row ? rowToCandidate(row) : null;
}

/** 同一 tension 已有 pending 或 accepted 候选 → 别再生成新候选。 */
export async function hasCandidateForTension(
  tensionId: string
): Promise<boolean> {
  const row = db()
    .prepare(
      `SELECT id FROM pref_candidates
       WHERE tension_id = ? AND status IN ('pending','accepted')
       LIMIT 1`
    )
    .get(tensionId) as { id: string } | undefined;
  return !!row;
}

export type CreateCandidateInput = {
  ownerId: string;
  projectId: string;
  tensionId?: string | null;
  threadId?: string | null;
  iconKey: TeamPrefIconKey;
  category: string;
  body: string;
  sourceHint?: string | null;
};

export async function createCandidate(
  input: CreateCandidateInput
): Promise<PrefCandidate> {
  const id = newId();
  const now = nowISO();
  db()
    .prepare(
      `INSERT INTO pref_candidates
        (id, owner_id, project_id, tension_id, thread_id, icon_key, category, body, source_hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.ownerId,
      input.projectId,
      input.tensionId ?? null,
      input.threadId ?? null,
      input.iconKey,
      input.category,
      input.body,
      input.sourceHint ?? null,
      now,
      now
    );
  const created = await getCandidate(id);
  if (!created) throw new Error('createCandidate: insert succeeded but read failed');
  return created;
}

export type UpdateCandidateInput = {
  iconKey?: TeamPrefIconKey;
  category?: string;
  body?: string;
};

/** 用户在弹卡上 inline 编辑后保存。仅 pending 状态可改。 */
export async function updateCandidate(
  id: string,
  input: UpdateCandidateInput
): Promise<PrefCandidate | null> {
  const existing = await getCandidate(id);
  if (!existing) return null;
  if (existing.status !== 'pending') return existing;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.iconKey !== undefined) {
    fields.push('icon_key = ?');
    values.push(input.iconKey);
  }
  if (input.category !== undefined) {
    fields.push('category = ?');
    values.push(input.category);
  }
  if (input.body !== undefined) {
    fields.push('body = ?');
    values.push(input.body);
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  values.push(nowISO());
  values.push(id);
  db()
    .prepare(`UPDATE pref_candidates SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return getCandidate(id);
}

export async function dismissCandidate(id: string): Promise<PrefCandidate | null> {
  db()
    .prepare(
      `UPDATE pref_candidates
       SET status = 'dismissed', updated_at = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(nowISO(), id);
  return getCandidate(id);
}

export async function markAccepted(
  id: string,
  prefId: string
): Promise<PrefCandidate | null> {
  db()
    .prepare(
      `UPDATE pref_candidates
       SET status = 'accepted', accepted_pref_id = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(prefId, nowISO(), id);
  return getCandidate(id);
}
