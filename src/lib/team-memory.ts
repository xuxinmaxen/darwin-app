import { db, assertOk, newId, nowISO } from './db';
import type { TeamPref, TeamPrefIconKey, AgentLearning, MemoryEvent } from './types';

type PrefRow = {
  id: string; owner_id: string; icon_key: string; category: string; body: string;
  source: string; source_cls: string; created_at: string; updated_at: string;
};

function rowToPref(row: PrefRow): TeamPref {
  return { id: row.id, iconKey: row.icon_key as TeamPrefIconKey, category: row.category,
    body: row.body, source: row.source, sourceCls: row.source_cls,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listPrefs(ownerId: string): Promise<TeamPref[]> {
  const result = await db().from('team_prefs').select('*').eq('owner_id', ownerId).order('created_at', { ascending: true });
  return assertOk(result).map(rowToPref);
}

export async function getPref(id: string): Promise<TeamPref | null> {
  const { data, error } = await db().from('team_prefs').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToPref(data as PrefRow) : null;
}

export type CreatePrefInput = {
  ownerId: string; iconKey: TeamPrefIconKey; category: string;
  body: string; source: string; sourceCls: string;
};

export async function createPref(input: CreatePrefInput): Promise<TeamPref> {
  const id = newId(); const now = nowISO();
  assertOk(await db().from('team_prefs').insert({
    id, owner_id: input.ownerId, icon_key: input.iconKey, category: input.category,
    body: input.body, source: input.source, source_cls: input.sourceCls, created_at: now, updated_at: now,
  }));
  const created = await getPref(id);
  if (!created) throw new Error('createPref: read failed');
  return created;
}

export type UpdatePrefInput = { iconKey?: TeamPrefIconKey; category?: string; body?: string; source?: string };

export async function updatePref(id: string, patch: UpdatePrefInput): Promise<TeamPref | null> {
  const existing = await getPref(id);
  if (!existing) return null;
  assertOk(await db().from('team_prefs').update({
    icon_key: patch.iconKey ?? existing.iconKey, category: patch.category ?? existing.category,
    body: patch.body ?? existing.body, source: patch.source ?? existing.source, updated_at: nowISO(),
  }).eq('id', id));
  return getPref(id);
}

export async function deletePref(id: string): Promise<boolean> {
  const { error, count } = await db().from('team_prefs').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

export function prefsToMarkdown(prefs: TeamPref[]): string {
  if (prefs.length === 0) return '# 团队共识\n\n_暂无_\n';
  const lines: string[] = ['# 团队共识', '', `> 由 Darwin 沉淀,${prefs.length} 条共识。导出时间: ${new Date().toLocaleString('zh-CN')}`, ''];
  const byCat = new Map<string, TeamPref[]>();
  for (const p of prefs) { const list = byCat.get(p.category) ?? []; list.push(p); byCat.set(p.category, list); }
  for (const [cat, list] of byCat) {
    lines.push(`## ${cat}`, '');
    for (const p of list) { lines.push(`- ${p.body}`, `  · 来源: ${p.source}`); }
    lines.push('');
  }
  return lines.join('\n');
}

export async function listAgentLearning(ownerId: string): Promise<AgentLearning[]> {
  const { data: agents } = await db().from('employees').select('id, name, role, cls, short, linked_human_id, tags_json, tags_intent_count')
    .eq('owner_id', ownerId).eq('kind', 'agent').order('created_at', { ascending: true });
  const results: AgentLearning[] = [];
  for (const a of (agents ?? []) as { id: string; name: string; role: string; cls: string; short: string; linked_human_id: string | null; tags_json: string | null; tags_intent_count: number | null }[]) {
    const { count: projectsCount } = await db().from('intents').select('project_id', { count: 'exact', head: true }).eq('author_id', a.id);
    const { count: intentsCount } = await db().from('intents').select('*', { count: 'exact', head: true }).eq('author_id', a.id);
    // tensions involving this agent: check intent_ids LIKE pattern
    const { count: tensionsCount } = await db().from('tensions').select('*', { count: 'exact', head: true }).like('intent_ids', `%${a.id}%`);
    let tags: string[] | null = null;
    if (a.tags_json) { try { const p = JSON.parse(a.tags_json); if (Array.isArray(p)) tags = p.filter((s: unknown) => typeof s === 'string'); } catch { /* ignore */ } }
    results.push({
      agentId: a.id, agentName: a.name, agentRole: a.role, agentCls: a.cls, agentShort: a.short,
      isDigitalTwin: !!a.linked_human_id, projectsRead: projectsCount ?? 0,
      intentsContributed: intentsCount ?? 0, tensionsTouched: tensionsCount ?? 0,
      tags, tagsIntentCount: a.tags_intent_count ?? 0,
    });
  }
  return results;
}

export async function listMemoryTimeline(ownerId: string, limit = 30): Promise<MemoryEvent[]> {
  const events: MemoryEvent[] = [];
  const { data: tensionRows } = await db().from('tensions').select('id, project_id, scope, variant, resolution, resolved_at, projects(name)')
    .eq('projects.owner_id', ownerId).eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(limit);
  type TRow = { id: string; project_id: string; scope: string; variant: string; resolution: string | null; resolved_at: string | null; projects: { name: string } | { name: string }[] | null };
  for (const t of (tensionRows ?? []) as unknown as TRow[]) {
    const projectName = Array.isArray(t.projects) ? t.projects[0]?.name ?? '' : (t.projects as { name: string } | null)?.name ?? '';
    if (!t.resolved_at) continue;
    let selectedKey = '?';
    try { const r = t.resolution ? JSON.parse(t.resolution) : null; if (r?.selectedOptionKey) selectedKey = r.selectedOptionKey; } catch { /* ignore */ }
    const isAgentVariant = t.variant === 'agents';
    events.push({ id: `tension:${t.id}`, kind: isAgentVariant ? 'agent-event' : 'consensus',
      body: isAgentVariant ? `**${t.scope}** 区 Agent ⇄ Agent 分歧 → 选定方案 **${selectedKey}**` : `**${t.scope}** 冲突 → 团队选定方案 **${selectedKey}**`,
      meta: isAgentVariant ? `Agent ⇄ Agent · 项目「${projectName}」` : `Human ⇄ Human · 项目「${projectName}」`,
      date: t.resolved_at, projectId: t.project_id });
  }
  const { data: empRows } = await db().from('employees').select('id, name, kind, linked_human_id, created_at')
    .eq('owner_id', ownerId).eq('kind', 'agent').order('created_at', { ascending: false }).limit(limit);
  for (const e of (empRows ?? []) as { id: string; name: string; kind: string; linked_human_id: string | null; created_at: string }[]) {
    const isDigital = !!e.linked_human_id;
    events.push({ id: `emp:${e.id}`, kind: 'onboarding',
      body: isDigital ? `数字分身 **${e.name}** 入职团队` : `Agent **${e.name}** 入职团队`,
      meta: '员工管理 · 新增 Agent', date: e.created_at });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : -1));
  return events.slice(0, limit);
}
