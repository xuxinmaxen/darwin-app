import { db, assertOk, newId, nowISO } from './db';
import type { PrefCandidate, PrefCandidateStatus, TeamPrefIconKey } from './types';

type Row = {
  id: string; owner_id: string; project_id: string; tension_id: string | null;
  thread_id: string | null; icon_key: string; category: string; body: string;
  source_hint: string | null; status: string; accepted_pref_id: string | null;
  created_at: string; updated_at: string;
};

function rowToCandidate(row: Row): PrefCandidate {
  return { id: row.id, ownerId: row.owner_id, projectId: row.project_id,
    tensionId: row.tension_id, threadId: row.thread_id, iconKey: row.icon_key as TeamPrefIconKey,
    category: row.category, body: row.body, sourceHint: row.source_hint,
    status: row.status as PrefCandidateStatus, acceptedPrefId: row.accepted_pref_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listPendingCandidates(projectId: string): Promise<PrefCandidate[]> {
  const result = await db().from('pref_candidates').select('*').eq('project_id', projectId).eq('status', 'pending').order('created_at', { ascending: true });
  return assertOk(result).map(rowToCandidate);
}

export async function getCandidate(id: string): Promise<PrefCandidate | null> {
  const { data, error } = await db().from('pref_candidates').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToCandidate(data as Row) : null;
}

export async function hasCandidateForTension(tensionId: string): Promise<boolean> {
  const { data } = await db().from('pref_candidates').select('id').eq('tension_id', tensionId).in('status', ['pending', 'accepted']).limit(1).maybeSingle();
  return !!data;
}

export type CreateCandidateInput = {
  ownerId: string; projectId: string; tensionId?: string | null; threadId?: string | null;
  iconKey: TeamPrefIconKey; category: string; body: string; sourceHint?: string | null;
};

export async function createCandidate(input: CreateCandidateInput): Promise<PrefCandidate> {
  const id = newId(); const now = nowISO();
  assertOk(await db().from('pref_candidates').insert({
    id, owner_id: input.ownerId, project_id: input.projectId,
    tension_id: input.tensionId ?? null, thread_id: input.threadId ?? null,
    icon_key: input.iconKey, category: input.category, body: input.body,
    source_hint: input.sourceHint ?? null, created_at: now, updated_at: now,
  }));
  const created = await getCandidate(id);
  if (!created) throw new Error('createCandidate: read failed');
  return created;
}

export type UpdateCandidateInput = { iconKey?: TeamPrefIconKey; category?: string; body?: string };

export async function updateCandidate(id: string, input: UpdateCandidateInput): Promise<PrefCandidate | null> {
  const existing = await getCandidate(id);
  if (!existing || existing.status !== 'pending') return existing ?? null;
  const patch: Record<string, unknown> = { updated_at: nowISO() };
  if (input.iconKey !== undefined) patch.icon_key = input.iconKey;
  if (input.category !== undefined) patch.category = input.category;
  if (input.body !== undefined) patch.body = input.body;
  if (Object.keys(patch).length === 1) return existing;
  assertOk(await db().from('pref_candidates').update(patch).eq('id', id));
  return getCandidate(id);
}

export async function dismissCandidate(id: string): Promise<PrefCandidate | null> {
  await db().from('pref_candidates').update({ status: 'dismissed', updated_at: nowISO() }).eq('id', id).eq('status', 'pending');
  return getCandidate(id);
}

export async function markAccepted(id: string, prefId: string): Promise<PrefCandidate | null> {
  await db().from('pref_candidates').update({ status: 'accepted', accepted_pref_id: prefId, updated_at: nowISO() }).eq('id', id).eq('status', 'pending');
  return getCandidate(id);
}
