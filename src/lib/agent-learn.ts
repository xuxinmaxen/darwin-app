/**
 * Agent 学习沉淀 — 服务层。
 *
 * publish hook 给每个 agent 协作者 fire-and-forget 调一次 learnFromProject。
 * 跟 agent-tags 的 recomputeAgentTags 并行跑, 失败互不影响 (调用方 Promise.allSettled)。
 *
 * 守卫:
 *   - 仅 agent kind
 *   - LLM 失败 / 超时 → 抛出, 由调用方 catch & log
 *   - 没 intent 也不跳过 (旁观也是学习; prompt 里有"主要旁观"分支)
 *
 * Server-only。
 */

import { getEmployee } from './employees';
import { getProject } from './projects';
import { listIntentsByProject } from './intents';
import { listTensions } from './tensions';
import { upsertLearning } from './learnings';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildAgentLearnSystem,
  buildAgentLearnUser,
  isValidAgentLearnOutput,
  type AgentLearnInput,
} from './prompts/agent-learn';

const LEARN_TIMEOUT_MS = 25_000;
const MAX_HIGHLIGHTS = 5;
const HIGHLIGHT_MAX_CHARS = 24;  // ≤20 字 + 容错余量

export type LearnFromProjectResult =
  | { ok: true; summary: string; highlights: string[] }
  | { ok: false; error: string };

export async function learnFromProject(
  employeeId: string,
  projectId: string
): Promise<LearnFromProjectResult> {
  const [employee, project] = await Promise.all([
    getEmployee(employeeId),
    getProject(projectId),
  ]);
  if (!employee) return { ok: false, error: 'employee not found' };
  if (!project) return { ok: false, error: 'project not found' };
  if (employee.kind !== 'agent') {
    return { ok: false, error: 'not an agent' };
  }
  if (!llmProvider()) {
    return { ok: false, error: 'no LLM provider' };
  }

  const [allIntents, allTensions] = await Promise.all([
    listIntentsByProject(projectId),
    listTensions(projectId),
  ]);

  const selfIntents = allIntents
    .filter(it => it.authorId === employeeId)
    .map(it => ({ statement: it.statement, scope: it.scope, type: it.type, weight: it.weight }));

  // 卷入的 tension = intentIds 里含该 agent 任一 intent
  const selfIntentIdSet = new Set(allIntents.filter(it => it.authorId === employeeId).map(it => it.id));
  const involvedTensions = allTensions
    .filter(t => t.status === 'resolved')
    .filter(t => (t.intentIds || []).some(id => selfIntentIdSet.has(id)))
    .map(t => ({ scope: t.scope, variant: t.variant, resolution: t.resolution }));

  const scopesInProject = Array.from(new Set(allIntents.map(it => it.scope))).slice(0, 12);

  const promptInput: AgentLearnInput = {
    agentName: employee.name,
    agentRole: employee.role,
    agentPersona: employee.persona ?? null,
    projectName: project.name,
    projectBackground: project.background ?? null,
    selfIntents,
    involvedTensions,
    totalIntents: allIntents.length,
    scopesInProject,
  };

  let parsed: { summary: string; highlights: string[] };
  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentLearnSystem(promptInput),
        user: buildAgentLearnUser(promptInput),
        cacheSystem: false,
        maxTokens: 400,
        temperature: 0.4,
        tier: 'full',  // 学习要写成 paragraph + chip, fast 模型容易输出空泛
      }),
      timeout(LEARN_TIMEOUT_MS),
    ]);
    if (!isValidAgentLearnOutput(out)) {
      return { ok: false, error: 'LLM output invalid' };
    }
    parsed = out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const summary = parsed.summary.trim();
  const highlights = parsed.highlights
    .map(h => h.trim())
    .filter(h => h.length > 0)
    .map(h => (h.length > HIGHLIGHT_MAX_CHARS ? h.slice(0, HIGHLIGHT_MAX_CHARS) : h))
    .slice(0, MAX_HIGHLIGHTS);
  const dedupHighlights = Array.from(new Set(highlights));

  await upsertLearning({
    employeeId,
    projectId,
    summary,
    highlights: dedupHighlights,
  });

  return { ok: true, summary, highlights: dedupHighlights };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`agent-learn 超时 ${ms}ms`)), ms)
  );
}
