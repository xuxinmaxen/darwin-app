/**
 * Agent 主动观察 — 服务层。
 *
 * 触发: 冲突解决后, resolve route 的 after() 块给每个参与该冲突的 agent fire-and-forget。
 * 跟 agent-react 的"被动反应"互补 — 这条是"反思后主动开口"。
 *
 * 守卫:
 *   - 仅 kind='agent' 才跑
 *   - 项目 / agent / tension 任一拉不到 → 早返回, 不抛
 *   - LLM 失败 / 超时 → 抛出, 由调用方 catch & log
 *   - LLM 输出 shouldSpeak=false → 静默, 不写库
 *   - LLM 输出 shouldSpeak=true → createIntent (statement 加 【观察】 前缀, IntentCard 自然渲染)
 *
 * Server-only。
 */

import { getEmployee } from './employees';
import { getProject } from './projects';
import { listIntentsByProject, createIntent } from './intents';
import { getTension } from './tensions';
import { listLearningsByEmployee } from './learnings';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildAgentObserveSystem,
  buildAgentObserveUser,
  isValidAgentObserveOutput,
  type AgentObserveInput,
} from './prompts/agent-observe';
import type { Intent } from './types';

const OBSERVE_TIMEOUT_MS = 25_000;

export type ObserveProjectResult =
  | { ok: true; spoke: true; intent: Intent }
  | { ok: true; spoke: false; reason?: string }
  | { ok: false; error: string };

export async function observeProject(
  employeeId: string,
  projectId: string,
  triggerTensionId: string
): Promise<ObserveProjectResult> {
  const [employee, project, tension] = await Promise.all([
    getEmployee(employeeId),
    getProject(projectId),
    getTension(triggerTensionId),
  ]);
  if (!employee) return { ok: false, error: 'employee not found' };
  if (!project) return { ok: false, error: 'project not found' };
  if (!tension) return { ok: false, error: 'tension not found' };
  if (employee.kind !== 'agent') return { ok: false, error: 'not an agent' };
  if (!llmProvider()) return { ok: false, error: 'no LLM provider' };

  const [allIntents, learnings] = await Promise.all([
    listIntentsByProject(projectId),
    listLearningsByEmployee(employeeId, 5).catch(() => []),
  ]);

  const scopesInProject = Array.from(new Set(allIntents.map(it => it.scope))).slice(0, 12);

  const promptInput: AgentObserveInput = {
    agent: employee,
    project: {
      name: project.name,
      type: project.type,
      background: project.background ?? null,
    },
    allIntents,
    resolvedTension: {
      scope: tension.scope,
      variant: tension.variant,
      options: tension.options,
      resolution: tension.resolution,
      intentIds: tension.intentIds,
    },
    learnings,
    scopesInProject,
  };

  let parsed;
  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentObserveSystem(promptInput),
        user: buildAgentObserveUser(promptInput),
        cacheSystem: false,
        maxTokens: 400,
        temperature: 0.4,
        tier: 'full',
      }),
      timeout(OBSERVE_TIMEOUT_MS),
    ]);
    if (!isValidAgentObserveOutput(out)) {
      return { ok: false, error: 'LLM output invalid' };
    }
    parsed = out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (parsed.shouldSpeak === false) {
    return { ok: true, spoke: false, reason: parsed.reason };
  }

  // 拼 【观察】 前缀, statement 已经是 "**Name** 注意到 ..." 形态
  const decoratedStatement = parsed.statement.startsWith('【观察】')
    ? parsed.statement
    : `【观察】 ${parsed.statement}`;

  const intent = await createIntent({
    projectId,
    authorId: employeeId,
    authorKind: 'agent',
    statement: decoratedStatement,
    type: parsed.type,
    scope: parsed.scope,
    weight: parsed.weight,
    rationale: parsed.rationale ?? null,
  });

  return { ok: true, spoke: true, intent };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`agent-observe 超时 ${ms}ms`)), ms)
  );
}
