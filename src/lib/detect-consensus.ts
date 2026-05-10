/**
 * Consensus 检测 — discussion thread 写完一条消息后 fire-and-forget 调一次,
 * 让 LLM 看是不是大家已经一致了。是 → 自动 resolveTension + 写决议消息,
 * Owner 不用再点 A/B/C。
 *
 * 守卫:
 *   - thread 必须 active + 关联 active tension
 *   - 非 system / 非 decision 的消息 ≥ 2 条 (一个人不算共识)
 *   - LLM confidence < 70 不写
 *
 * Server-only。
 */

import { getThread, listMessages, createMessage, resolveThread } from './threads';
import { getTension, resolveTension } from './tensions';
import { getProject } from './projects';
import { getEmployee } from './employees';
import { maybeBackToCollaborating } from './detect-tension';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildConsensusSystem,
  buildConsensusUser,
  isValidConsensusOutput,
} from './prompts/detect-consensus';

const TIMEOUT_MS = 20_000;
const CONFIDENCE_FLOOR = 70;
const AI_CONSENSUS_ID = 'ai-consensus';

export type ConsensusResult =
  | { ok: true; reached: false; reason: string }
  | { ok: true; reached: true; selectedKey: string; summary: string }
  | { ok: false; error: string };

export async function detectConsensusForThread(
  threadId: string
): Promise<ConsensusResult> {
  if (!llmProvider()) return { ok: false, error: 'no LLM provider' };

  const thread = await getThread(threadId);
  if (!thread) return { ok: false, error: 'thread not found' };
  if (thread.status !== 'active') {
    return { ok: true, reached: false, reason: 'thread not active' };
  }
  if (!thread.tensionId) {
    return { ok: true, reached: false, reason: 'thread has no tension' };
  }

  const tension = await getTension(thread.tensionId);
  if (!tension || tension.status !== 'active') {
    return { ok: true, reached: false, reason: 'tension not active' };
  }

  const messages = await listMessages(threadId);
  // 至少 2 条非 system / 非 decision 的发言才有判共识的资格
  const speakers = messages.filter(
    m => m.authorKind !== 'system' && !m.isDecision
  );
  const distinctAuthors = new Set(speakers.map(m => m.authorId));
  if (speakers.length < 2 || distinctAuthors.size < 2) {
    return { ok: true, reached: false, reason: 'not enough speakers yet' };
  }

  const project = await getProject(thread.projectId);
  if (!project) return { ok: false, error: 'project not found' };
  const owner = await getEmployee(project.ownerId).catch(() => null);

  let parsed;
  try {
    parsed = await Promise.race([
      callLLMJSON<unknown>({
        system: buildConsensusSystem({
          scope: thread.scope,
          options: tension.options,
          messages,
          ownerName: owner?.name ?? '项目 Owner',
        }),
        user: buildConsensusUser({
          scope: thread.scope,
          options: tension.options,
          messages,
          ownerName: owner?.name ?? '项目 Owner',
        }),
        cacheSystem: false,
        maxTokens: 300,
        temperature: 0.1,
      }),
      timeout(TIMEOUT_MS),
    ]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!isValidConsensusOutput(parsed)) {
    return { ok: false, error: 'LLM output invalid' };
  }
  if (parsed.reached === false) {
    return { ok: true, reached: false, reason: parsed.reason };
  }
  if (parsed.confidence < CONFIDENCE_FLOOR) {
    return {
      ok: true,
      reached: false,
      reason: `confidence ${parsed.confidence} < ${CONFIDENCE_FLOOR}`,
    };
  }

  const selectedOption = tension.options.find(o => o.key === parsed.selectedKey);
  if (!selectedOption) {
    return { ok: false, error: `selectedKey "${parsed.selectedKey}" not in options` };
  }

  // 写一条 system 决议消息, 标明是 AI 检测到的共识
  await createMessage({
    threadId,
    authorId: AI_CONSENSUS_ID,
    authorKind: 'system',
    body: [
      `🤝 AI 检测到团队达成一致: 选定方案 **${parsed.selectedKey}** · ${selectedOption.title}`,
      '',
      parsed.summary,
    ].join('\n'),
    isDecision: true,
    decisionPayload: { selectedOptionKey: parsed.selectedKey },
  });

  // 落地: tension + thread 都 resolve
  await resolveTension({
    tensionId: tension.id,
    selectedOptionKey: parsed.selectedKey,
    decidedBy: [AI_CONSENSUS_ID],
    threadId,
  });
  await resolveThread(threadId);
  await maybeBackToCollaborating(thread.projectId);

  // fire-and-forget 抽 pref 候选
  setTimeout(() => {
    import('./extract-pref-candidate')
      .then(m => m.extractPrefCandidateForTension(tension.id))
      .catch(() => { /* 静默 */ });
  }, 0);

  return {
    ok: true,
    reached: true,
    selectedKey: parsed.selectedKey,
    summary: parsed.summary,
  };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`detect-consensus 超时 ${ms}ms`)), ms)
  );
}
