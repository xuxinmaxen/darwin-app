import { db, assertOk, newId, nowISO } from './db';
import type { Project, ProjectType, ConflictMode, ProjectStatus } from './types';
import type { Employee } from './employees';

type ProjectRow = {
  id: string; name: string; type: string; background: string | null;
  conflict_mode: string; status: string; owner_id: string;
  created_at: string; updated_at: string;
};

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id, name: row.name, type: row.type as ProjectType,
    background: row.background, conflictMode: row.conflict_mode as ConflictMode,
    status: row.status as ProjectStatus, ownerId: row.owner_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

type EmployeeRow = {
  id: string; kind: 'human' | 'agent'; name: string; short: string;
  role: string; email: string | null; persona: string | null; cls: string;
  linked_human_id: string | null; is_online: number; tags_json: string | null;
  tags_intent_count: number; owner_id: string; created_at: string; updated_at: string;
  last_active_at?: string | null;
};

const ONLINE_THRESHOLD_MS = 90_000;

function rowToEmployee(row: EmployeeRow): Employee {
  let tags: string[] | null = null;
  if (row.tags_json) {
    try { const p = JSON.parse(row.tags_json); if (Array.isArray(p)) tags = p.filter((s: unknown) => typeof s === 'string'); } catch { /* ignore */ }
  }
  // 与 employees.ts 一致: agent 永远在线, 真人看 last_active_at 是否在 90s 内
  let isOnline = false;
  if (row.kind === 'agent') {
    isOnline = true;
  } else if (row.last_active_at) {
    const t = new Date(row.last_active_at).getTime();
    if (!Number.isNaN(t) && Date.now() - t < ONLINE_THRESHOLD_MS) isOnline = true;
  }
  return {
    id: row.id, kind: row.kind, name: row.name, short: row.short, role: row.role,
    email: row.email, persona: row.persona, cls: row.cls,
    linkedHumanId: row.linked_human_id ?? null, isOnline,
    tags, tagsIntentCount: row.tags_intent_count ?? 0,
    ownerId: row.owner_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listProjects(ownerId?: string): Promise<Project[]> {
  const q = db().from('projects').select('*').order('updated_at', { ascending: false });
  const result = ownerId ? await q.eq('owner_id', ownerId) : await q;
  return assertOk(result).map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await db().from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToProject(data as ProjectRow) : null;
}

export type CreateProjectInput = {
  name: string; type: ProjectType; background?: string | null;
  conflictMode?: ConflictMode; ownerId: string; collaboratorIds?: string[];
};

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const id = newId();
  const now = nowISO();
  const allCollabs = Array.from(new Set([input.ownerId, ...(input.collaboratorIds ?? [])]));
  assertOk(await db().from('projects').insert({
    id, name: input.name, type: input.type, background: input.background ?? null,
    conflict_mode: input.conflictMode ?? 'discuss', status: 'draft',
    owner_id: input.ownerId, created_at: now, updated_at: now,
  }));
  if (allCollabs.length > 0) {
    assertOk(await db().from('project_collaborators').insert(
      allCollabs.map(empId => ({ project_id: id, employee_id: empId, added_at: now }))
    ));
  }
  const created = await getProject(id);
  if (!created) throw new Error('createProject: read failed after insert');
  return created;
}

export async function listCollaborators(projectId: string): Promise<Employee[]> {
  const { data, error } = await db()
    .from('project_collaborators')
    .select('employee_id, employees(*)')
    .eq('project_id', projectId)
    .order('added_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { employees: unknown }) => rowToEmployee(r.employees as EmployeeRow));
}

export async function listCollaboratorsByProjects(
  projectIds: string[]
): Promise<Map<string, Employee[]>> {
  const result = new Map<string, Employee[]>();
  for (const id of projectIds) result.set(id, []);
  if (projectIds.length === 0) return result;
  const { data, error } = await db()
    .from('project_collaborators')
    .select('project_id, employees(*)')
    .in('project_id', projectIds)
    .order('added_at', { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { project_id: string; employees: unknown }[]) {
    const list = result.get(row.project_id) ?? [];
    list.push(rowToEmployee(row.employees as EmployeeRow));
    result.set(row.project_id, list);
  }
  return result;
}

export async function setCollaborators(
  projectId: string, ownerId: string, collaboratorIds: string[]
): Promise<void> {
  const all = Array.from(new Set([ownerId, ...collaboratorIds]));
  const now = nowISO();
  assertOk(await db().from('project_collaborators').delete().eq('project_id', projectId));
  if (all.length > 0) {
    assertOk(await db().from('project_collaborators').insert(
      all.map(empId => ({ project_id: projectId, employee_id: empId, added_at: now }))
    ));
  }
}

export async function deleteProject(id: string): Promise<void> {
  assertOk(await db().from('projects').delete().eq('id', id));
}

export type UpdateProjectInput = {
  name?: string; background?: string | null; status?: ProjectStatus; conflictMode?: ConflictMode;
};

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const patch: Record<string, unknown> = { updated_at: nowISO() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.background !== undefined) patch.background = input.background;
  if (input.status !== undefined) patch.status = input.status;
  if (input.conflictMode !== undefined) patch.conflict_mode = input.conflictMode;
  assertOk(await db().from('projects').update(patch).eq('id', id));
  const updated = await getProject(id);
  if (!updated) throw new Error(`updateProject(${id}): not found after update`);
  return updated;
}

export async function bumpToCollaborating(id: string): Promise<void> {
  await db().from('projects')
    .update({ status: 'collaborating', updated_at: nowISO() })
    .eq('id', id).eq('status', 'draft');
}

export async function markPublished(id: string): Promise<void> {
  await db().from('projects')
    .update({ status: 'published', updated_at: nowISO() })
    .eq('id', id);
}
