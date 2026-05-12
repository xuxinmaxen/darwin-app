/**
 * Agent Tags 计算 — 给定一个 agent.id, 拉它写过的 Intent, 调 LLM 抽 ≤3 个学习 tag,
 * 写回 employees.tags_json + tags_intent_count。
 *
 * 触发点 (fire-and-forget):
 *   - /api/employees/[id]/recompute-tags POST (UI 显式触发或页面自检)
 *   - 后续可考虑: agent 写完 Intent 后 fire-and-forget 重抽
 *
 * 守卫:
 *   - 仅 agent kind 才计算
 *   - intent 数量 < 2 → 写空数组 (但仍更新 tags_intent_count)
 *   - LLM 失败 → 不写 (保留旧 tags)
 *
 * Server-only。
 */

import { db, nowISO } from './db';
import { getEmployee } from './employees';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildAgentTagsSystem,
  buildAgentTagsUser,
  isValidAgentTagsOutput,
  type AgentTagsInput,
} from './prompts/agent-tags';

const TAGS_TIMEOUT_MS = 20_000;
const TAG_MAX_CHARS = 6;
const MAX_TAGS = 3;

export type RecomputeTagsResult =
  | { ok: true; tags: string[]; intentCount: number; skipped?: 'unchanged' | 'not-agent' }
  | { ok: false; error: string };

export async function recomputeAgentTags(
  agentId: string
): Promise<RecomputeTagsResult> {
  const employee = await getEmployee(agentId);
  if (!employee) return { ok: false, error: 'employee not found' };
  if (employee.kind !== 'agent') {
    return {
      ok: true,
      tags: [],
      intentCount: 0,
      skipped: 'not-agent',
    };
  }

  // 拉 agent 写过的 intent (按时间正序)
  const { data: intentData } = await db().from('intents')
    .select('statement, scope, type, weight')
    .eq('author_id', agentId).eq('author_kind', 'agent')
    .order('created_at', { ascending: true });
  const rows = (intentData ?? []) as AgentTagsInput['intents'];
  const intentCount = rows.length;

  // intent 没变化 → 不重算 (省 LLM 调用)
  if (
    intentCount === employee.tagsIntentCount &&
    employee.tags !== null &&
    employee.tags !== undefined
  ) {
    return {
      ok: true,
      tags: employee.tags,
      intentCount,
      skipped: 'unchanged',
    };
  }

  // intent < 2 → 写空 tag
  if (intentCount < 2) {
    writeTags(agentId, [], intentCount);
    return { ok: true, tags: [], intentCount };
  }

  if (!llmProvider()) {
    return { ok: false, error: 'no LLM provider' };
  }

  let parsed: { tags: string[] };
  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentTagsSystem({
          agentName: employee.name,
          agentRole: employee.role,
          agentPersona: employee.persona ?? null,
          intents: rows,
        }),
        user: buildAgentTagsUser({
          agentName: employee.name,
          agentRole: employee.role,
          agentPersona: employee.persona ?? null,
          intents: rows,
        }),
        cacheSystem: false,
        maxTokens: 200,
        temperature: 0.2,
        tier: 'fast',
      }),
      timeout(TAGS_TIMEOUT_MS),
    ]);
    if (!isValidAgentTagsOutput(out)) {
      return { ok: false, error: 'LLM output invalid' };
    }
    parsed = out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 清洗 + 截断
  const cleaned = parsed.tags
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .filter(t => !/^(ai|agent|智能|助手)$/i.test(t))
    .map(t => (t.length > TAG_MAX_CHARS ? t.slice(0, TAG_MAX_CHARS) : t))
    .slice(0, MAX_TAGS);

  // 去重
  const dedup = Array.from(new Set(cleaned));

  writeTags(agentId, dedup, intentCount);
  return { ok: true, tags: dedup, intentCount };
}

function writeTags(agentId: string, tags: string[], intentCount: number) {
  // fire-and-forget — we don't await here (caller is also fire-and-forget)
  db().from('employees').update({
    tags_json: JSON.stringify(tags),
    tags_intent_count: intentCount,
    updated_at: nowISO(),
  }).eq('id', agentId).then(() => { /* ignore */ });
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`agent-tags 超时 ${ms}ms`)), ms)
  );
}
