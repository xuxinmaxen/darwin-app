/**
 * Employee queries.
 *
 * 员工分两类:
 *   - human: 真实成员, 必填 email
 *   - agent: AI 同事, 必填 persona (人设/视角)
 *
 * 头像颜色 (cls) 在创建时从 palette 里挑一个未占用的, 头像首字 (short)
 * 用 name 第一个字符自动算。前端不传这两个字段。
 */

import { db, newId, nowISO } from './db';

export type EmployeeKind = 'human' | 'agent';

export type Employee = {
  id: string;
  kind: EmployeeKind;
  name: string;
  short: string;
  role: string;
  email: string | null;
  persona: string | null;
  cls: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

type EmployeeRow = {
  id: string;
  kind: EmployeeKind;
  name: string;
  short: string;
  role: string;
  email: string | null;
  persona: string | null;
  cls: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

const HUMAN_PALETTE = ['xu', 'li', 'wang', 'chen', 'zhang'];
const AGENT_PALETTE = [
  'agent-blue',
  'agent-pink',
  'agent-violet',
  'agent-emerald',
  'agent-amber',
];

export const ROLE_OPTIONS = ['PM', 'UI', 'RD', '运营', '增长', '文案', 'CEO'];

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    short: row.short,
    role: row.role,
    email: row.email,
    persona: row.persona,
    cls: row.cls,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Pick the first palette entry not already used by another employee of same kind. */
function pickAvatarClass(
  ownerId: string,
  kind: EmployeeKind
): string {
  const palette = kind === 'agent' ? AGENT_PALETTE : HUMAN_PALETTE;
  const taken = db()
    .prepare(
      `SELECT cls FROM employees WHERE owner_id = ? AND kind = ?`
    )
    .all(ownerId, kind) as { cls: string }[];
  const takenSet = new Set(taken.map(t => t.cls));
  return palette.find(c => !takenSet.has(c)) || palette[taken.length % palette.length];
}

function firstChar(s: string): string {
  // 中文/英文/emoji 都用 spread 拿到 grapheme 的第一项
  return [...s.trim()][0] || '?';
}

export async function listEmployees(ownerId: string): Promise<Employee[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM employees WHERE owner_id = ? ORDER BY created_at ASC`
    )
    .all(ownerId) as EmployeeRow[];
  return rows.map(rowToEmployee);
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const row = db()
    .prepare(`SELECT * FROM employees WHERE id = ?`)
    .get(id) as EmployeeRow | undefined;
  return row ? rowToEmployee(row) : null;
}

export type CreateEmployeeInput = {
  ownerId: string;
  kind: EmployeeKind;
  name: string;
  role: string;
  email?: string | null;     // human only
  persona?: string | null;   // agent only
};

export async function createEmployee(
  input: CreateEmployeeInput
): Promise<Employee> {
  const id =
    (input.kind === 'agent' ? 'a_' : 'e_') + newId().slice(0, 8);
  const cls = pickAvatarClass(input.ownerId, input.kind);
  const short = firstChar(input.name);
  const now = nowISO();
  const email = input.kind === 'human' ? (input.email?.trim() || null) : null;
  const persona = input.kind === 'agent' ? (input.persona?.trim() || null) : null;

  db()
    .prepare(
      `INSERT INTO employees
        (id, kind, name, short, role, email, persona, cls, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.kind,
      input.name,
      short,
      input.role,
      email,
      persona,
      cls,
      input.ownerId,
      now,
      now
    );

  return {
    id,
    kind: input.kind,
    name: input.name,
    short,
    role: input.role,
    email,
    persona,
    cls,
    ownerId: input.ownerId,
    createdAt: now,
    updatedAt: now,
  };
}

export type UpdateEmployeeInput = {
  name?: string;
  role?: string;
  email?: string | null;
  persona?: string | null;
};

export async function updateEmployee(
  id: string,
  patch: UpdateEmployeeInput
): Promise<Employee | null> {
  const existing = await getEmployee(id);
  if (!existing) return null;

  const name = patch.name !== undefined ? patch.name : existing.name;
  const short = firstChar(name);
  const role = patch.role !== undefined ? patch.role : existing.role;
  // kind 不可改; email 只对 human, persona 只对 agent
  const email =
    existing.kind === 'human'
      ? patch.email !== undefined ? (patch.email?.trim() || null) : existing.email
      : null;
  const persona =
    existing.kind === 'agent'
      ? patch.persona !== undefined ? (patch.persona?.trim() || null) : existing.persona
      : null;
  const now = nowISO();

  db()
    .prepare(
      `UPDATE employees
       SET name = ?, short = ?, role = ?, email = ?, persona = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(name, short, role, email, persona, now, id);

  return getEmployee(id);
}

export async function deleteEmployee(id: string): Promise<boolean> {
  const result = db()
    .prepare(`DELETE FROM employees WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}
