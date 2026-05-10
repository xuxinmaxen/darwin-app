/**
 * Extract Pref Candidate — tension 解决后调一次, 让 LLM 看决议 + 讨论,
 * 抽出"团队共识候选"。如果 LLM 觉得没值得沉淀的就静默返回。
 *
 * 调用点 (fire-and-forget):
 *   - tension /resolve 路径
 *   - arbitrate-tension 路径
 *
 * 守卫:
 *   - 同 tensionId 已有 pending/accepted 候选 → 不重复跑
 *   - LLM confidence < 60 → 也不写
 *
 * Server-only。
 */

import { getProject } from './projects';
import { getTension } from './tensions';
import { getIntent } from './intents';
import { getEmployee } from './employees';
import {
  findThreadByTension,
  listMessages,
} from './threads';
import {
  hasCandidateForTension,
  createCandidate,
} from './pref-candidates';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildExtractPrefSystem,
  buildExtractPrefUser,
  isValidExtractOutput,
  type ExtractPrefInput,
} from './prompts/extract-pref-candidate';

const EXTRACT_TIMEOUT_MS = 25_000;
const CONFIDENCE_FLOOR = 60;

export type ExtractResult =
  | { ok: true; created: false; reason: string }
  | { ok: true; created: true; candidateId: string }
  | { ok: false; error: string };

export async function extractPrefCandidateForTension(
  tensionId: string
): Promise<ExtractResult> {
  if (!llmProvider()) return { ok: false, error: 'no LLM provider' };

  const tension = await getTension(tensionId);
  if (!tension) return { ok: false, error: 'tension not found' };
  if (tension.status !== 'resolved' || !tension.resolution) {
    return { ok: false, error: 'tension not resolved yet' };
  }

  // 守卫: 已有候选不重复
  if (await hasCandidateForTension(tensionId)) {
    return { ok: true, created: false, reason: 'candidate already exists' };
  }

  const project = await getProject(tension.projectId);
  if (!project) return { ok: false, error: 'project not found' };

  const [intentA, intentB] = await Promise.all([
    getIntent(tension.intentIds[0]),
    getIntent(tension.intentIds[1]),
  ]);
  if (!intentA || !intentB) return { ok: false, error: 'intents not found' };

  const [empA, empB] = await Promise.all([
    getEmployee(intentA.authorId),
    getEmployee(intentB.authorId),
  ]);

  const selected = tension.options.find(
    o => o.key === tension.resolution!.selectedOptionKey
  );
  if (!selected) {
    return { ok: false, error: 'selected option not in options' };
  }

  // 拉关联 thread 的最近消息 (作为讨论上下文)
  let recentMessages: ExtractPrefInput['recentMessages'] = [];
  let threadId: string | null = tension.resolution.threadId ?? null;
  if (!threadId) {
    const t = await findThreadByTension(tensionId);
    threadId = t?.id ?? null;
  }
  let decisionSummary: string | null = null;
  if (threadId) {
    const all = await listMessages(threadId);
    recentMessages = all.map(m => ({
      authorKind: m.authorKind,
      body: m.body,
      isDecision: m.isDecision,
    }));
    // AI 仲裁路径会把决议摘要写在 isDecision 消息开头, 拉出来给 LLM 当 hint
    const decision = all.find(m => m.isDecision);
    if (decision) decisionSummary = decision.body;
  }

  const input: ExtractPrefInput = {
    project: {
      name: project.name,
      type: project.type,
      background: project.background ?? null,
    },
    scope: tension.scope,
    partyA: { name: empA?.name ?? 'A', intent: intentA },
    partyB: { name: empB?.name ?? 'B', intent: intentB },
    selectedOption: selected,
    decisionSummary,
    recentMessages,
  };

  let out;
  try {
    out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildExtractPrefSystem(input),
        user: buildExtractPrefUser(input),
        cacheSystem: false,
        maxTokens: 500,
        temperature: 0.2,
      }),
      timeout(EXTRACT_TIMEOUT_MS),
    ]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!isValidExtractOutput(out)) {
    return { ok: false, error: 'LLM output failed validation' };
  }
  if (out.worth === false) {
    return { ok: true, created: false, reason: out.reason || 'not worth' };
  }
  if (out.confidence < CONFIDENCE_FLOOR) {
    return {
      ok: true,
      created: false,
      reason: `confidence ${out.confidence} below floor ${CONFIDENCE_FLOOR}`,
    };
  }

  const candidate = await createCandidate({
    ownerId: project.ownerId,
    projectId: project.id,
    tensionId,
    threadId,
    iconKey: out.iconKey,
    category: out.category.trim().slice(0, 24),
    body: out.body.trim().slice(0, 200),
    sourceHint: out.sourceHint.trim().slice(0, 60),
  });

  return { ok: true, created: true, candidateId: candidate.id };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`extract-pref 超时 ${ms}ms`)), ms)
  );
}
