/**
 * Intent queries (Supabase).
 * Server-only.
 */

import { supabaseAdmin } from './supabase/server';
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
  };
}

export async function listIntentsByProject(
  projectId: string
): Promise<Intent[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('intents')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listIntentsByProject: ${error.message}`);
  return (data as IntentRow[]).map(rowToIntent);
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
};

export async function createIntent(
  input: CreateIntentInput
): Promise<Intent> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('intents')
    .insert({
      project_id: input.projectId,
      author_id: input.authorId,
      author_kind: input.authorKind,
      statement: input.statement,
      // V1 placeholder defaults — Phase 3 replaces these by calling Claude.
      type: input.type ?? 'Goal',
      scope: input.scope ?? 'global',
      weight: input.weight ?? 'should',
      rationale: input.rationale ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`createIntent: ${error.message}`);
  return rowToIntent(data as IntentRow);
}

export async function deleteIntent(id: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from('intents').delete().eq('id', id);
  if (error) throw new Error(`deleteIntent(${id}): ${error.message}`);
}

/**
 * 给一组项目批量取最近的 Intent 摘要（卡片预览用）。
 * 一次查询内拉全部，再在内存里按 project_id 聚合，避免 N+1。
 */
export async function summarizeIntentsForProjects(
  projectIds: string[]
): Promise<Map<string, { count: number; preview?: string }>> {
  const result = new Map<string, { count: number; preview?: string }>();
  if (projectIds.length === 0) return result;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('intents')
    .select('project_id, statement, created_at')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`summarizeIntentsForProjects: ${error.message}`);

  type Row = { project_id: string; statement: string; created_at: string };
  const grouped = new Map<string, Row[]>();
  for (const row of (data as Row[]) ?? []) {
    const list = grouped.get(row.project_id) ?? [];
    list.push(row);
    grouped.set(row.project_id, list);
  }

  for (const id of projectIds) {
    const rows = grouped.get(id) ?? [];
    if (rows.length === 0) {
      result.set(id, { count: 0 });
      continue;
    }
    const preview = rows
      .slice(0, 3)
      .map(r => r.statement.replace(/\s+/g, ' ').trim())
      .join(' · ');
    result.set(id, { count: rows.length, preview });
  }

  return result;
}
