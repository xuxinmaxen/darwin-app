import { db, assertOk, newId, nowISO } from './db';
import type { Intent, IntentType, IntentWeight, AuthorKind } from './types';

type IntentRow = {
  id: string; project_id: string; author_id: string; author_kind: string;
  statement: string; type: string; scope: string; weight: string;
  rationale: string | null; created_at: string; trigger_intent_id: string | null;
};

function rowToIntent(row: IntentRow): Intent {
  return {
    id: row.id, projectId: row.project_id, authorId: row.author_id,
    authorKind: row.author_kind as AuthorKind, statement: row.statement,
    type: row.type as IntentType, scope: row.scope, weight: row.weight as IntentWeight,
    rationale: row.rationale, createdAt: row.created_at,
    triggerIntentId: row.trigger_intent_id ?? null,
  };
}

export async function listIntentsByProject(projectId: string): Promise<Intent[]> {
  const result = await db().from('intents').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
  return assertOk(result).map(rowToIntent);
}

export type CreateIntentInput = {
  projectId: string; authorId: string; authorKind: AuthorKind; statement: string;
  type?: IntentType; scope?: string; weight?: IntentWeight; rationale?: string | null;
  triggerIntentId?: string | null;
};

export async function createIntent(input: CreateIntentInput): Promise<Intent> {
  const id = newId();
  const now = nowISO();
  const row = {
    id, project_id: input.projectId, author_id: input.authorId,
    author_kind: input.authorKind, statement: input.statement,
    type: input.type ?? 'Goal', scope: input.scope ?? 'global',
    weight: input.weight ?? 'should', rationale: input.rationale ?? null,
    trigger_intent_id: input.triggerIntentId ?? null, created_at: now,
  };
  assertOk(await db().from('intents').insert(row));
  return rowToIntent(row as IntentRow);
}

export async function chainDepthOf(intentId: string, maxDepth = 8): Promise<number> {
  let cursor: string | null = intentId;
  let depth = 0;
  while (cursor && depth < maxDepth) {
    const { data } = await db().from('intents').select('author_kind, trigger_intent_id').eq('id', cursor).maybeSingle();
    if (!data) return depth;
    const row = data as { author_kind: string; trigger_intent_id: string | null };
    if (row.author_kind === 'human') return depth;
    if (!row.trigger_intent_id) return depth;
    depth += 1;
    cursor = row.trigger_intent_id;
  }
  return depth;
}

export async function getIntent(id: string): Promise<Intent | null> {
  const { data, error } = await db().from('intents').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToIntent(data as IntentRow) : null;
}

export async function deleteIntent(id: string): Promise<{ projectId: string; staleTensionIds: string[] } | null> {
  const { data: intentData } = await db().from('intents').select('project_id').eq('id', id).maybeSingle();
  if (!intentData) return null;
  const projectId = (intentData as { project_id: string }).project_id;

  // Find active tensions referencing this intent
  const { data: tensionRows } = await db().from('tensions')
    .select('id, intent_ids').eq('project_id', projectId).eq('status', 'active');
  const staleTensionIds: string[] = [];
  for (const t of (tensionRows ?? []) as { id: string; intent_ids: string }[]) {
    let ids: string[] = [];
    try { ids = JSON.parse(t.intent_ids); } catch { /* ignore */ }
    if (ids.includes(id)) staleTensionIds.push(t.id);
  }

  // Delete the intent (cascade removes its related rows)
  assertOk(await db().from('intents').delete().eq('id', id));

  // Mark stale tensions resolved
  if (staleTensionIds.length > 0) {
    const now = nowISO();
    const resolution = JSON.stringify({ selectedOptionKey: 'stale', decidedBy: ['system'], decidedAt: now, threadId: null });
    await db().from('tensions').update({ status: 'resolved', resolution, resolved_at: now }).in('id', staleTensionIds);

    // Close related active threads + add system message
    for (const tid of staleTensionIds) {
      const { data: threadData } = await db().from('threads').select('id').eq('tension_id', tid).eq('status', 'active').maybeSingle();
      if (threadData) {
        const threadId = (threadData as { id: string }).id;
        await db().from('thread_messages').insert({
          id: newId(), thread_id: threadId, author_id: 'system', author_kind: 'system',
          body: '⚠️ 关联 Intent 已删除,冲突自动撤销。', is_decision: 1, created_at: now,
        });
        await db().from('threads').update({ status: 'resolved', resolved_at: now }).eq('id', threadId);
      }
    }

    // Recompute project status
    const { count } = await db().from('tensions').select('*', { count: 'exact', head: true })
      .eq('project_id', projectId).eq('status', 'active');
    if ((count ?? 0) === 0) {
      await db().from('projects').update({ status: 'collaborating', updated_at: now })
        .eq('id', projectId).eq('status', 'tension');
    }
  }

  return { projectId, staleTensionIds };
}

export async function summarizeIntentsForProjects(projectIds: string[]): Promise<Map<string, { count: number; preview?: string }>> {
  const result = new Map<string, { count: number; preview?: string }>();
  for (const id of projectIds) result.set(id, { count: 0 });
  if (projectIds.length === 0) return result;
  const { data } = await db().from('intents').select('project_id, statement')
    .in('project_id', projectIds).order('created_at', { ascending: false });
  const grouped = new Map<string, string[]>();
  for (const row of (data ?? []) as { project_id: string; statement: string }[]) {
    const list = grouped.get(row.project_id) ?? [];
    list.push(row.statement);
    grouped.set(row.project_id, list);
  }
  for (const id of projectIds) {
    const statements = grouped.get(id) ?? [];
    if (statements.length === 0) { result.set(id, { count: 0 }); continue; }
    const preview = statements.slice(0, 3).map(s => s.replace(/\s+/g, ' ').trim()).join(' · ');
    result.set(id, { count: statements.length, preview });
  }
  return result;
}
