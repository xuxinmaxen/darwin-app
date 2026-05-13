import { db, assertOk, newId, nowISO } from './db';
import type { Tension, TensionOption, TensionResolution, TensionStatus, TensionVariant } from './types';

type TensionRow = {
  id: string; project_id: string; scope: string; intent_ids: string;
  variant: string; status: string; options: string; resolution: string | null;
  created_at: string; resolved_at: string | null;
};

function rowToTension(row: TensionRow): Tension {
  let intentIds: string[] = [], options: TensionOption[] = [], resolution: TensionResolution | null = null;
  try { intentIds = JSON.parse(row.intent_ids); } catch { /* ignore */ }
  try { options = JSON.parse(row.options); } catch { /* ignore */ }
  if (row.resolution) { try { resolution = JSON.parse(row.resolution); } catch { /* ignore */ } }
  return {
    id: row.id, projectId: row.project_id, scope: row.scope, intentIds,
    variant: row.variant as TensionVariant, status: row.status as TensionStatus,
    options, resolution, createdAt: row.created_at, resolvedAt: row.resolved_at ?? null,
  };
}

export async function listTensions(projectId: string): Promise<Tension[]> {
  const result = await db().from('tensions').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  return assertOk(result).map(rowToTension);
}

export async function listActiveTensions(projectId: string): Promise<Tension[]> {
  const result = await db().from('tensions').select('*').eq('project_id', projectId).eq('status', 'active').order('created_at', { ascending: true });
  return assertOk(result).map(rowToTension);
}

export async function getTension(id: string): Promise<Tension | null> {
  const { data, error } = await db().from('tensions').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToTension(data as TensionRow) : null;
}

export async function findActiveTensionFor(projectId: string, scope: string, intentIds: string[]): Promise<Tension | null> {
  const fingerprint = [...intentIds].sort().join(',');
  const { data } = await db().from('tensions').select('*').eq('project_id', projectId).eq('scope', scope).eq('status', 'active');
  for (const row of (data ?? []) as TensionRow[]) {
    let ids: string[] = [];
    try { ids = JSON.parse(row.intent_ids); } catch { /* ignore */ }
    if ([...ids].sort().join(',') === fingerprint) return rowToTension(row);
  }
  return null;
}

/** 查任意状态 (含 resolved) 的 tension — 用于"已调和过的冲突不再重复识别"的去重判断 */
export async function findAnyTensionFor(projectId: string, scope: string, intentIds: string[]): Promise<Tension | null> {
  const fingerprint = [...intentIds].sort().join(',');
  const { data } = await db().from('tensions').select('*').eq('project_id', projectId).eq('scope', scope);
  for (const row of (data ?? []) as TensionRow[]) {
    let ids: string[] = [];
    try { ids = JSON.parse(row.intent_ids); } catch { /* ignore */ }
    if ([...ids].sort().join(',') === fingerprint) return rowToTension(row);
  }
  return null;
}

export type CreateTensionInput = {
  projectId: string; scope: string; intentIds: string[];
  variant: TensionVariant; options: TensionOption[];
};

export async function createTension(input: CreateTensionInput): Promise<Tension> {
  const id = newId();
  const now = nowISO();
  assertOk(await db().from('tensions').insert({
    id, project_id: input.projectId, scope: input.scope,
    intent_ids: JSON.stringify(input.intentIds), variant: input.variant,
    status: 'active', options: JSON.stringify(input.options), created_at: now,
  }));
  return { id, projectId: input.projectId, scope: input.scope, intentIds: input.intentIds,
    variant: input.variant, status: 'active', options: input.options,
    resolution: null, createdAt: now, resolvedAt: null };
}

export type ResolveTensionInput = {
  tensionId: string; selectedOptionKey: string; decidedBy: string[]; threadId?: string | null;
};

export async function resolveTension(input: ResolveTensionInput): Promise<Tension | null> {
  const existing = await getTension(input.tensionId);
  if (!existing) return null;
  if (existing.status === 'resolved') return existing;
  const now = nowISO();
  const resolution: TensionResolution = {
    selectedOptionKey: input.selectedOptionKey, decidedBy: input.decidedBy,
    decidedAt: now, threadId: input.threadId ?? null,
  };
  assertOk(await db().from('tensions').update({
    status: 'resolved', resolution: JSON.stringify(resolution), resolved_at: now,
  }).eq('id', input.tensionId));
  return getTension(input.tensionId);
}
