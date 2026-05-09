/**
 * Team Memory — 组织级共识、Agent 学习、决策时间线。
 *
 * 三块数据来源:
 *   1. team_prefs 表 — 团队共识 (CRUD)
 *   2. AgentLearning — 实时从 intents/tensions 计算 (不存表)
 *   3. MemoryEvent timeline — 实时从 tensions/employees/threads 聚合
 *
 * 这样设计避免了"事件双写一致性"问题: 数据源已经存在 (intents/tensions/employees),
 * memory 只是读层投影。
 *
 * Server-only。
 */

import { db, newId, nowISO } from './db';
import type {
  TeamPref,
  TeamPrefIconKey,
  AgentLearning,
  MemoryEvent,
} from './types';

// ─── Prefs ─────────────────────────────────────────────────

type PrefRow = {
  id: string;
  owner_id: string;
  icon_key: string;
  category: string;
  body: string;
  source: string;
  source_cls: string;
  created_at: string;
  updated_at: string;
};

function rowToPref(row: PrefRow): TeamPref {
  return {
    id: row.id,
    iconKey: row.icon_key as TeamPrefIconKey,
    category: row.category,
    body: row.body,
    source: row.source,
    sourceCls: row.source_cls,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPrefs(ownerId: string): Promise<TeamPref[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM team_prefs WHERE owner_id = ? ORDER BY created_at ASC`
    )
    .all(ownerId) as PrefRow[];
  return rows.map(rowToPref);
}

export async function getPref(id: string): Promise<TeamPref | null> {
  const row = db()
    .prepare(`SELECT * FROM team_prefs WHERE id = ?`)
    .get(id) as PrefRow | undefined;
  return row ? rowToPref(row) : null;
}

export type CreatePrefInput = {
  ownerId: string;
  iconKey: TeamPrefIconKey;
  category: string;
  body: string;
  source: string;
  sourceCls: string;
};

export async function createPref(input: CreatePrefInput): Promise<TeamPref> {
  const id = newId();
  const now = nowISO();
  db()
    .prepare(
      `INSERT INTO team_prefs
        (id, owner_id, icon_key, category, body, source, source_cls, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.ownerId,
      input.iconKey,
      input.category,
      input.body,
      input.source,
      input.sourceCls,
      now,
      now
    );
  return {
    id,
    iconKey: input.iconKey,
    category: input.category,
    body: input.body,
    source: input.source,
    sourceCls: input.sourceCls,
    createdAt: now,
    updatedAt: now,
  };
}

export type UpdatePrefInput = {
  iconKey?: TeamPrefIconKey;
  category?: string;
  body?: string;
  source?: string;
};

export async function updatePref(
  id: string,
  patch: UpdatePrefInput
): Promise<TeamPref | null> {
  const existing = await getPref(id);
  if (!existing) return null;
  const now = nowISO();
  db()
    .prepare(
      `UPDATE team_prefs
       SET icon_key = ?, category = ?, body = ?, source = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.iconKey ?? existing.iconKey,
      patch.category ?? existing.category,
      patch.body ?? existing.body,
      patch.source ?? existing.source,
      now,
      id
    );
  return getPref(id);
}

export async function deletePref(id: string): Promise<boolean> {
  const result = db()
    .prepare(`DELETE FROM team_prefs WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

/** 把 prefs 列表导出成 markdown — 可粘贴到 Claude/GPT/Cursor 全局规范 */
export function prefsToMarkdown(prefs: TeamPref[]): string {
  if (prefs.length === 0) {
    return '# 团队共识\n\n_暂无_\n';
  }
  const lines: string[] = ['# 团队共识', ''];
  lines.push(`> 由 Darwin 沉淀,${prefs.length} 条共识。导出时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  // 按 category 分组
  const byCat = new Map<string, TeamPref[]>();
  for (const p of prefs) {
    const list = byCat.get(p.category) ?? [];
    list.push(p);
    byCat.set(p.category, list);
  }
  for (const [cat, list] of byCat) {
    lines.push(`## ${cat}`);
    lines.push('');
    for (const p of list) {
      // body 已经是 markdown lite (含 **strong**), 直接写
      lines.push(`- ${p.body}`);
      lines.push(`  · 来源: ${p.source}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Agent Learning ────────────────────────────────────────

export async function listAgentLearning(
  ownerId: string
): Promise<AgentLearning[]> {
  // 取所有 agent 员工 (含数字员工)
  const agents = db()
    .prepare(
      `SELECT id, name, role, cls, short, linked_human_id
       FROM employees
       WHERE owner_id = ? AND kind = 'agent'
       ORDER BY created_at ASC`
    )
    .all(ownerId) as {
      id: string;
      name: string;
      role: string;
      cls: string;
      short: string;
      linked_human_id: string | null;
    }[];

  const results: AgentLearning[] = [];
  for (const a of agents) {
    const projects = db()
      .prepare(
        `SELECT COUNT(DISTINCT project_id) AS n FROM intents WHERE author_id = ?`
      )
      .get(a.id) as { n: number };
    const intents = db()
      .prepare(`SELECT COUNT(*) AS n FROM intents WHERE author_id = ?`)
      .get(a.id) as { n: number };
    // 卷入冲突: tension.intent_ids 含该 agent 写的 intent → 太复杂用 SQL,
    // 简化: 用 LIKE 模糊匹配 (intent_ids 是 JSON array)
    const tensions = db()
      .prepare(
        `SELECT COUNT(*) AS n FROM tensions t
         WHERE t.intent_ids LIKE '%' || (
           SELECT id FROM intents WHERE author_id = ? LIMIT 1
         ) || '%'
           AND EXISTS (
             SELECT 1 FROM intents i
             WHERE i.author_id = ? AND t.intent_ids LIKE '%' || i.id || '%'
           )`
      )
      .get(a.id, a.id) as { n: number };

    results.push({
      agentId: a.id,
      agentName: a.name,
      agentRole: a.role,
      agentCls: a.cls,
      agentShort: a.short,
      isDigitalTwin: !!a.linked_human_id,
      projectsRead: projects.n,
      intentsContributed: intents.n,
      tensionsTouched: tensions.n,
    });
  }
  return results;
}

// ─── Timeline ──────────────────────────────────────────────

export async function listMemoryTimeline(
  ownerId: string,
  limit = 30
): Promise<MemoryEvent[]> {
  const events: MemoryEvent[] = [];

  // 1. resolved tensions → consensus / agent-event
  const tensionRows = db()
    .prepare(
      `SELECT t.id, t.project_id, t.scope, t.variant, t.resolution, t.resolved_at,
              p.name AS project_name
       FROM tensions t
       JOIN projects p ON p.id = t.project_id
       WHERE p.owner_id = ? AND t.status = 'resolved'
       ORDER BY t.resolved_at DESC
       LIMIT ?`
    )
    .all(ownerId, limit) as {
      id: string;
      project_id: string;
      scope: string;
      variant: string;
      resolution: string | null;
      resolved_at: string | null;
      project_name: string;
    }[];

  for (const t of tensionRows) {
    if (!t.resolved_at) continue;
    let selectedKey = '?';
    try {
      const r = t.resolution ? JSON.parse(t.resolution) : null;
      if (r?.selectedOptionKey) selectedKey = r.selectedOptionKey;
    } catch { /* ignore */ }
    const isAgentVariant = t.variant === 'agents';
    events.push({
      id: `tension:${t.id}`,
      kind: isAgentVariant ? 'agent-event' : 'consensus',
      body: isAgentVariant
        ? `**${t.scope}** 区 Agent ⇄ Agent 分歧 → 选定方案 **${selectedKey}**`
        : `**${t.scope}** 冲突 → 团队选定方案 **${selectedKey}**`,
      meta: isAgentVariant
        ? `Agent ⇄ Agent · 项目「${t.project_name}」`
        : `Human ⇄ Human · 项目「${t.project_name}」`,
      date: t.resolved_at,
      projectId: t.project_id,
    });
  }

  // 2. agent 入职 (created_at) → onboarding
  const empRows = db()
    .prepare(
      `SELECT id, name, kind, linked_human_id, created_at
       FROM employees
       WHERE owner_id = ? AND kind = 'agent'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(ownerId, limit) as {
      id: string;
      name: string;
      kind: string;
      linked_human_id: string | null;
      created_at: string;
    }[];
  for (const e of empRows) {
    const isDigital = !!e.linked_human_id;
    events.push({
      id: `emp:${e.id}`,
      kind: 'onboarding',
      body: isDigital
        ? `数字员工 **${e.name}** 入职团队`
        : `Agent **${e.name}** 入职团队`,
      meta: '员工管理 · 新增 Agent',
      date: e.created_at,
    });
  }

  // 时间倒序合并
  events.sort((a, b) => (a.date < b.date ? 1 : -1));
  return events.slice(0, limit);
}
