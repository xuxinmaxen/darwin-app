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
  /** 数字员工: 指向其依附的真人 employee.id; null = 独立 Agent 或真人本身 */
  linkedHumanId: string | null;
  /** 仅对真人有意义; Agent 总视作 online */
  isOnline: boolean;
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
  linked_human_id: string | null;
  is_online: number;
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
    linkedHumanId: row.linked_human_id ?? null,
    // SQLite 0/1 → boolean
    isOnline: row.is_online !== 0,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 数字员工的默认 persona — 真人不在场时 AI 替身的发言基调。 */
function defaultDigitalPersona(human: { name: string; role: string }): string {
  return `${human.name} 的 AI 替身 (${human.role})。代 ${human.name} 出席项目协作:发言简洁、贴角色,只在 ${human.role} 视角真有补充时说话;最终决策仍由本人定。`;
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
  /** 仅 human: true 时同时建一个数字员工 (AI 替身) */
  withDigital?: boolean;
  /** 仅 human: 创建时的 online 状态。默认 true */
  isOnline?: boolean;
  /** 内部用: 创建数字员工时指向真人 id */
  linkedHumanId?: string | null;
};

export type CreateEmployeeResult = {
  employee: Employee;
  digital: Employee | null;
};

export async function createEmployee(
  input: CreateEmployeeInput
): Promise<CreateEmployeeResult> {
  const id = newId();
  const conn = db();

  const tx = conn.transaction(() => {
    const cls = pickAvatarClass(input.ownerId, input.kind);
    const short = firstChar(input.name);
    const now = nowISO();
    const email = input.kind === 'human' ? (input.email?.trim() || null) : null;
    const persona = input.kind === 'agent' ? (input.persona?.trim() || null) : null;
    const isOnline = input.kind === 'human' ? (input.isOnline !== false) : true;

    conn
      .prepare(
        `INSERT INTO employees
          (id, kind, name, short, role, email, persona, cls, linked_human_id, is_online, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        input.linkedHumanId ?? null,
        isOnline ? 1 : 0,
        input.ownerId,
        now,
        now
      );

    let digital: Employee | null = null;

    // human + withDigital → 同时建数字员工
    if (input.kind === 'human' && input.withDigital) {
      const digitalId = newId();
      const digitalCls = pickAvatarClass(input.ownerId, 'agent');
      const digitalName = `${input.name} AI`;
      const digitalShort = firstChar(input.name);
      const digitalPersona = defaultDigitalPersona({
        name: input.name,
        role: input.role,
      });
      conn
        .prepare(
          `INSERT INTO employees
            (id, kind, name, short, role, email, persona, cls, linked_human_id, is_online, owner_id, created_at, updated_at)
           VALUES (?, 'agent', ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          digitalId,
          digitalName,
          digitalShort,
          input.role,
          digitalPersona,
          digitalCls,
          id,
          input.ownerId,
          now,
          now
        );
      digital = {
        id: digitalId,
        kind: 'agent',
        name: digitalName,
        short: digitalShort,
        role: input.role,
        email: null,
        persona: digitalPersona,
        cls: digitalCls,
        linkedHumanId: id,
        isOnline: true,
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
      };
    }

    return digital;
  });

  const digital = tx();
  const created = await getEmployee(id);
  if (!created) throw new Error('createEmployee: insert succeeded but read failed');
  return { employee: created, digital };
}

export async function findDigitalForHuman(
  humanId: string
): Promise<Employee | null> {
  const row = db()
    .prepare(
      `SELECT * FROM employees WHERE linked_human_id = ? LIMIT 1`
    )
    .get(humanId) as EmployeeRow | undefined;
  return row ? rowToEmployee(row) : null;
}

/** 给已存在的真人补一个数字员工 (编辑场景: 之前没勾, 现在勾上)。 */
export async function ensureDigitalForHuman(
  humanId: string
): Promise<Employee | null> {
  const human = await getEmployee(humanId);
  if (!human || human.kind !== 'human') return null;
  const existing = await findDigitalForHuman(humanId);
  if (existing) return existing;
  const result = await createEmployee({
    ownerId: human.ownerId,
    kind: 'agent',
    name: `${human.name} AI`,
    role: human.role,
    persona: defaultDigitalPersona({ name: human.name, role: human.role }),
    linkedHumanId: humanId,
  });
  return result.employee;
}

export async function setOnline(
  id: string,
  isOnline: boolean
): Promise<Employee | null> {
  const existing = await getEmployee(id);
  if (!existing) return null;
  if (existing.kind !== 'human') {
    // Agent 永远 online, 不允许调
    return existing;
  }
  db()
    .prepare(
      `UPDATE employees SET is_online = ?, updated_at = ? WHERE id = ?`
    )
    .run(isOnline ? 1 : 0, nowISO(), id);
  return getEmployee(id);
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

  // 数字员工 (kind=agent + linkedHumanId) 的 name 不接受外部修改 —
  // 它必须保持 "<真人> AI" 格式, 由真人 name 决定。
  const isDigitalTwin = existing.kind === 'agent' && !!existing.linkedHumanId;
  const name = isDigitalTwin
    ? existing.name
    : patch.name !== undefined ? patch.name : existing.name;
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

  const conn = db();
  const tx = conn.transaction(() => {
    conn
      .prepare(
        `UPDATE employees
         SET name = ?, short = ?, role = ?, email = ?, persona = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(name, short, role, email, persona, now, id);

    // 真人改名 → 同步它的数字员工: name 跟随 "<真人> AI", short 跟真人, role 也跟
    if (existing.kind === 'human') {
      const renamed = patch.name !== undefined && patch.name !== existing.name;
      const reroled = patch.role !== undefined && patch.role !== existing.role;
      if (renamed || reroled) {
        const twinRow = conn
          .prepare(`SELECT id, persona FROM employees WHERE linked_human_id = ?`)
          .get(id) as { id: string; persona: string | null } | undefined;
        if (twinRow) {
          const twinName = `${name} AI`;
          const twinShort = firstChar(name);
          // persona 跟着 role 重写为默认值; 如果用户编辑过 persona, 这里会覆盖。
          // 取舍: 改名/角色变了, 旧 persona 大概率失语境; 用户能在 twin 卡上重写。
          const twinPersona = reroled
            ? defaultDigitalPersona({ name, role })
            : twinRow.persona;
          conn
            .prepare(
              `UPDATE employees
               SET name = ?, short = ?, role = ?, persona = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(twinName, twinShort, role, twinPersona, now, twinRow.id);
        }
      }
    }
  });
  tx();

  return getEmployee(id);
}

export type DeleteEmployeeResult = {
  ok: boolean;
  /** 一并被级联删除的数字员工 (如果有), 用于前端反馈 */
  cascadedTwin: Employee | null;
};

export async function deleteEmployee(id: string): Promise<DeleteEmployeeResult> {
  const existing = await getEmployee(id);
  if (!existing) return { ok: false, cascadedTwin: null };

  let cascadedTwin: Employee | null = null;

  // 真人被删 → 同事务里删它的数字员工 (项目协作者由 FK ON DELETE CASCADE 自动清)
  if (existing.kind === 'human') {
    cascadedTwin = await findDigitalForHuman(id);
  }

  const conn = db();
  const tx = conn.transaction(() => {
    if (cascadedTwin) {
      conn.prepare(`DELETE FROM employees WHERE id = ?`).run(cascadedTwin.id);
    }
    conn.prepare(`DELETE FROM employees WHERE id = ?`).run(id);
  });
  tx();

  return { ok: true, cascadedTwin };
}
