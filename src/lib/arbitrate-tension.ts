/**
 * AI 仲裁 — 当 project.conflictMode === 'ai_decide':
 *   tension 创建后, AI 直接给三个调和方案打分 + 选最佳, 并把"决议"写成
 *   thread 的 system 消息 (附评分明细), 同时 resolveTension。
 *
 * 入口:
 *   - detect-tension.ts 创建 tension 后, 看模式 fire-and-forget
 *   - 用户在 TensionCard 上手动点"让 AI 评分决策" → 走 endpoint 调进来
 *
 * 失败策略:
 *   - LLM 失败/超时 → 不 resolve tension, 返回 ok: false。
 *     UI 由调用方处理 (静默 / 展示重试)。
 *
 * Server-only。
 */

import { getProject } from './projects';
import { getTension, resolveTension } from './tensions';
import { getIntent } from './intents';
import { getEmployee } from './employees';
import {
  findThreadByTension,
  createThread,
  createMessage,
  resolveThread,
} from './threads';
import { maybeBackToCollaborating } from './detect-tension';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildArbitrateSystem,
  buildArbitrateUser,
  isValidArbitrateOutput,
  type ArbitrateInput,
  type ArbitrateOutput,
} from './prompts/arbitrate-tension';

const ARBITRATE_TIMEOUT_MS = 25_000;
const AI_DECIDER_ID = 'ai-arbitrator';

export type ArbitrateResult =
  | {
      ok: true;
      selectedKey: string;
      decisionSummary: string;
      scores: Array<{ key: string; score: number; reason: string }>;
    }
  | { ok: false; error: string };

/**
 * 给定 tensionId, 让 LLM 仲裁 + 写决策 + resolve。
 * 幂等: 如果 tension 已 resolved, 立刻返回 ok=true 不重复仲裁。
 */
export async function arbitrateTension(tensionId: string): Promise<ArbitrateResult> {
  if (!llmProvider()) {
    return { ok: false, error: 'no LLM provider configured' };
  }

  const tension = await getTension(tensionId);
  if (!tension) return { ok: false, error: 'tension not found' };
  if (tension.status === 'resolved') {
    return {
      ok: true,
      selectedKey: tension.resolution?.selectedOptionKey ?? '?',
      decisionSummary: '(already resolved)',
      scores: [],
    };
  }
  if (tension.options.length < 2) {
    return { ok: false, error: 'tension has no scorable options' };
  }

  const project = await getProject(tension.projectId);
  if (!project) return { ok: false, error: 'project not found' };

  const [intentA, intentB] = await Promise.all([
    getIntent(tension.intentIds[0]),
    getIntent(tension.intentIds[1]),
  ]);
  if (!intentA || !intentB) {
    return { ok: false, error: 'intents not found' };
  }
  const [empA, empB] = await Promise.all([
    getEmployee(intentA.authorId),
    getEmployee(intentB.authorId),
  ]);
  const partyAName = empA?.name ?? '?';
  const partyBName = empB?.name ?? '?';

  const arbitrateInput: ArbitrateInput = {
    project: {
      name: project.name,
      type: project.type,
      background: project.background ?? null,
    },
    scope: tension.scope,
    partyA: { name: partyAName, intent: intentA },
    partyB: { name: partyBName, intent: intentB },
    options: tension.options,
  };

  let out: ArbitrateOutput;
  try {
    const raw = await Promise.race([
      callLLMJSON<unknown>({
        system: buildArbitrateSystem(arbitrateInput),
        user: buildArbitrateUser(arbitrateInput),
        cacheSystem: false,
        maxTokens: 800,
        temperature: 0.2,
        tier: 'fast',
      }),
      timeout(ARBITRATE_TIMEOUT_MS),
    ]);
    if (!isValidArbitrateOutput(raw)) {
      return { ok: false, error: 'LLM output missing required fields' };
    }
    out = raw;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 校验 selectedKey 在 options 内
  const selectedOption = tension.options.find(o => o.key === out.selectedKey);
  if (!selectedOption) {
    return {
      ok: false,
      error: `LLM selectedKey "${out.selectedKey}" 不在 options 列表`,
    };
  }

  // 找/创建 thread (tension 关联), 写决策消息 + resolve
  let thread = await findThreadByTension(tensionId);
  if (!thread) {
    const opening = [
      `**${tension.scope}** 区块发现冲突: **${partyAName}** ⇄ **${partyBName}**`,
      '',
      `${partyAName} 主张: ${intentA.statement}`,
      `${partyBName} 主张: ${intentB.statement}`,
      '',
      `项目设置为 **AI 评分决策** 模式, AI 已给出仲裁。`,
    ].join('\n');
    thread = await createThread({
      projectId: tension.projectId,
      scope: tension.scope,
      title: `${tension.scope} · ${partyAName} ⇄ ${partyBName} · AI 仲裁`,
      tensionId: tension.id,
      openingMessages: [
        {
          authorId: 'system',
          authorKind: 'system',
          body: opening,
        },
      ],
    });
  }

  // 评分明细 + 决策摘要 → 一条 system 决策消息
  const scoreLines = out.scores
    .map(s => `- **${s.key}**${s.key === out.selectedKey ? ' ✓' : ''} · ${s.score}/100 — ${s.reason}`)
    .join('\n');
  const decisionBody = [
    `🤖 AI 仲裁结果: 选定方案 **${out.selectedKey}** · ${selectedOption.title}`,
    '',
    out.decisionSummary,
    '',
    '评分明细:',
    scoreLines,
  ].join('\n');

  await createMessage({
    threadId: thread.id,
    authorId: AI_DECIDER_ID,
    authorKind: 'system',
    body: decisionBody,
    isDecision: true,
    decisionPayload: { selectedOptionKey: out.selectedKey },
  });

  await resolveTension({
    tensionId,
    selectedOptionKey: out.selectedKey,
    decidedBy: [AI_DECIDER_ID],
    threadId: thread.id,
  });
  await resolveThread(thread.id);
  await maybeBackToCollaborating(tension.projectId);

  // fire-and-forget: 让 LLM 决定要不要从这次仲裁里抽出团队共识候选
  setTimeout(() => {
    import('./extract-pref-candidate')
      .then(m => m.extractPrefCandidateForTension(tensionId))
      .then(r => {
        if (!r.ok) console.warn('[extract-pref] failed:', r.error);
      })
      .catch(err => console.warn('[extract-pref] threw:', err));
  }, 0);

  return {
    ok: true,
    selectedKey: out.selectedKey,
    decisionSummary: out.decisionSummary,
    scores: out.scores,
  };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`arbitrate-tension 超时 ${ms}ms`)), ms)
  );
}
