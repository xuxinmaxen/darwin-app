import { db, assertOk, newId, nowISO } from './db';

export type EmployeeKind = 'human' | 'agent';

export type Employee = {
  id: string; kind: EmployeeKind; name: string; short: string; role: string;
  email: string | null; persona: string | null; cls: string;
  linkedHumanId: string | null; isOnline: boolean;
  tags?: string[] | null; tagsIntentCount: number;
  ownerId: string; createdAt: string; updatedAt: string;
};

type EmployeeRow = {
  id: string; kind: 'human' | 'agent'; name: string; short: string;
  role: string; email: string | null; persona: string | null; cls: string;
  linked_human_id: string | null; is_online: number; tags_json: string | null;
  tags_intent_count: number; owner_id: string; created_at: string; updated_at: string;
};

export const ROLE_OPTIONS = ['PM', 'UI', 'RD', '运营', '增长', '文案', 'CEO'];

const HUMAN_PALETTE = ['xu', 'li', 'wang', 'chen', 'zhang'];
const AGENT_PALETTE = ['agent-blue', 'agent-pink', 'agent-violet', 'agent-emerald', 'agent-amber'];

function rowToEmployee(row: EmployeeRow): Employee {
  let tags: string[] | null = null;
  if (row.tags_json) {
    try { const p = JSON.parse(row.tags_json); if (Array.isArray(p)) tags = p.filter((s: unknown) => typeof s === 'string'); } catch { /* ignore */ }
  }
  return {
    id: row.id, kind: row.kind, name: row.name, short: row.short, role: row.role,
    email: row.email, persona: row.persona, cls: row.cls,
    linkedHumanId: row.linked_human_id ?? null, isOnline: row.is_online !== 0,
    tags, tagsIntentCount: row.tags_intent_count ?? 0,
    ownerId: row.owner_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function firstChar(s: string): string { return [...s.trim()][0] || '?'; }

async function pickAvatarClass(ownerId: string, kind: EmployeeKind): Promise<string> {
  const palette = kind === 'agent' ? AGENT_PALETTE : HUMAN_PALETTE;
  const { data } = await db().from('employees').select('cls').eq('owner_id', ownerId).eq('kind', kind);
  const takenSet = new Set((data ?? []).map((r: { cls: string }) => r.cls));
  return palette.find(c => !takenSet.has(c)) || palette[(data?.length ?? 0) % palette.length];
}

export async function listEmployees(ownerId: string): Promise<Employee[]> {
  const result = await db().from('employees').select('*').eq('owner_id', ownerId).order('created_at', { ascending: true });
  return assertOk(result).map(rowToEmployee);
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const { data, error } = await db().from('employees').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToEmployee(data as EmployeeRow) : null;
}

export type CreateEmployeeInput = {
  ownerId: string; kind: EmployeeKind; name: string; role: string;
  email?: string | null; persona?: string | null; withDigital?: boolean;
  isOnline?: boolean; linkedHumanId?: string | null;
};

export type CreateEmployeeResult = { employee: Employee; digital: Employee | null };

export async function createEmployee(input: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  const id = newId();
  const now = nowISO();
  const cls = await pickAvatarClass(input.ownerId, input.kind);
  const short = firstChar(input.name);
  assertOk(await db().from('employees').insert({
    id, kind: input.kind, name: input.name, short, role: input.role,
    email: input.email ?? null, persona: input.persona ?? null, cls,
    linked_human_id: input.linkedHumanId ?? null,
    is_online: input.isOnline !== false ? 1 : 0,
    tags_json: null, tags_intent_count: 0,
    owner_id: input.ownerId, created_at: now, updated_at: now,
  }));
  const employee = await getEmployee(id);
  if (!employee) throw new Error('createEmployee: read failed after insert');

  let digital: Employee | null = null;
  if (input.kind === 'human' && input.withDigital) {
    const result = await createEmployee({
      ownerId: input.ownerId, kind: 'agent',
      name: `${input.name} AI`, role: input.role,
      persona: defaultDigitalPersona({ name: input.name, role: input.role }),
      linkedHumanId: id, isOnline: true,
    });
    digital = result.employee;
  }
  return { employee, digital };
}

function defaultDigitalPersona(human: { name: string; role: string }): string {
  return `${human.name} 的数字分身 (${human.role})。代 ${human.name} 出席项目协作:发言简洁、贴角色,只在 ${human.role} 视角真有补充时说话;最终决策仍由本人定。`;
}

export async function findDigitalForHuman(humanId: string): Promise<Employee | null> {
  const { data, error } = await db().from('employees').select('*').eq('linked_human_id', humanId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToEmployee(data as EmployeeRow) : null;
}

export async function ensureDigitalForHuman(human: Employee): Promise<Employee> {
  const existing = await findDigitalForHuman(human.id);
  if (existing) return existing;
  const result = await createEmployee({
    ownerId: human.ownerId, kind: 'agent',
    name: `${human.name} AI`, role: human.role,
    persona: defaultDigitalPersona({ name: human.name, role: human.role }),
    linkedHumanId: human.id, isOnline: true,
  });
  return result.employee;
}

export async function setOnline(id: string, isOnline: boolean): Promise<Employee | null> {
  assertOk(await db().from('employees').update({ is_online: isOnline ? 1 : 0, updated_at: nowISO() }).eq('id', id));
  return getEmployee(id);
}

export type UpdateEmployeeInput = {
  name?: string; role?: string; email?: string | null; persona?: string | null;
  cls?: string; isOnline?: boolean; tags?: string[] | null; tagsIntentCount?: number;
};

export async function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<Employee | null> {
  const patch: Record<string, unknown> = { updated_at: nowISO() };
  if (input.name !== undefined) { patch.name = input.name; patch.short = firstChar(input.name); }
  if (input.role !== undefined) patch.role = input.role;
  if (input.email !== undefined) patch.email = input.email;
  if (input.persona !== undefined) patch.persona = input.persona;
  if (input.cls !== undefined) patch.cls = input.cls;
  if (input.isOnline !== undefined) patch.is_online = input.isOnline ? 1 : 0;
  if (input.tags !== undefined) patch.tags_json = input.tags ? JSON.stringify(input.tags) : null;
  if (input.tagsIntentCount !== undefined) patch.tags_intent_count = input.tagsIntentCount;
  assertOk(await db().from('employees').update(patch).eq('id', id));
  return getEmployee(id);
}

export type DeleteEmployeeResult = { id: string; cascadedTwin?: { id: string; name: string } | null };

export async function deleteEmployee(id: string): Promise<DeleteEmployeeResult> {
  const twin = await findDigitalForHuman(id);
  if (twin) {
    assertOk(await db().from('employees').delete().eq('id', twin.id));
  }
  assertOk(await db().from('employees').delete().eq('id', id));
  return { id, cascadedTwin: twin ? { id: twin.id, name: twin.name } : null };
}
