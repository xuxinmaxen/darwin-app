/**
 * Agent 接话核心 logic — 给一个 Agent + 一条 trigger Intent, 决定 spoke/silent。
 *
 * Route handler (`/api/projects/:id/agent-react`) 是这个 helper 的 HTTP 包装;
 * helper 自己也用于 chain fan-out (一个 Agent 接话后, 异步通知其他 Agent 看看要不要接)。
 *
 * Server-only。
 */

import type { Intent } from './types';
import type { Employee } from './employees';
import { db } from './db';
import { getProject, listCollaborators, bumpToCollaborating } from './projects';
import { getEmployee } from './employees';
import {
  listIntentsByProject,
  createIntent,
  getIntent,
  chainDepthOf,
} from './intents';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildAgentReactSystem,
  buildAgentReactUser,
  isValidAgentReactOutput,
} from './prompts/agent-react';

/** human → react Agent 最多走几跳。链超过这个深度就强制沉默。 */
export const MAX_CHAIN_DEPTH = 2;

const REACT_TIMEOUT_MS = 25_000;

export type ReactOutcome =
  | { ok: true; reaction: 'spoke'; intent: Intent }
  | { ok: true; reaction: 'silent'; reason: string }
  | { ok: false; error: string; status: number };

export type ReactInput = {
  projectId: string;
  agentEmployeeId: string;
  triggerIntentId: string;
};

export async function reactOnce(input: ReactInput): Promise<ReactOutcome> {
  if (!llmProvider()) {
    return { ok: false, error: 'LLM 未配置', status: 502 };
  }

  const [project, agent, triggerIntent] = await Promise.all([
    getProject(input.projectId),
    getEmployee(input.agentEmployeeId),
    getIntent(input.triggerIntentId),
  ]);

  if (!project) return { ok: false, error: 'project not found', status: 404 };
  if (!agent || agent.kind !== 'agent') {
    return { ok: false, error: 'agent not found', status: 404 };
  }
  if (!triggerIntent || triggerIntent.projectId !== input.projectId) {
    return { ok: false, error: 'trigger intent not in this project', status: 400 };
  }

  // self-trigger 拒绝
  if (triggerIntent.authorId === agent.id) {
    return { ok: true, reaction: 'silent', reason: 'self-trigger' };
  }

  // chain 深度门禁
  const triggerDepth = await chainDepthOf(triggerIntent.id);
  const newDepth = triggerDepth + 1;
  if (newDepth > MAX_CHAIN_DEPTH) {
    return {
      ok: true,
      reaction: 'silent',
      reason: `chain-too-deep (${newDepth} > ${MAX_CHAIN_DEPTH})`,
    };
  }

  // 同 agent 不重复 react 同一 trigger (前端 fan-out 和后端 fan-out 可能重叠)
  const dup = db()
    .prepare(
      `SELECT 1 FROM intents WHERE author_id = ? AND trigger_intent_id = ? LIMIT 1`
    )
    .get(agent.id, triggerIntent.id);
  if (dup) {
    return { ok: true, reaction: 'silent', reason: 'already-reacted' };
  }

  const collaborators = await listCollaborators(input.projectId);
  const isMember = collaborators.some(c => c.id === agent.id);
  if (!isMember) {
    return {
      ok: false,
      error: `${agent.name} 不在该项目协作者里`,
      status: 400,
    };
  }

  const existingIntents = await listIntentsByProject(input.projectId);

  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentReactSystem({
          agent,
          project: {
            name: project.name,
            type: project.type,
            background: project.background ?? null,
          },
          collaborators,
          existingIntents,
          triggerIntent,
        }),
        user: buildAgentReactUser({
          agent,
          project: {
            name: project.name,
            type: project.type,
            background: project.background ?? null,
          },
          collaborators,
          existingIntents,
          triggerIntent,
        }),
        cacheSystem: false,
        maxTokens: 400,
        temperature: 0.4,
      }),
      timeout(REACT_TIMEOUT_MS),
    ]);

    if (!isValidAgentReactOutput(out)) {
      return {
        ok: false,
        error: `Agent 返回 schema 不合法: ${JSON.stringify(out).slice(0, 160)}`,
        status: 502,
      };
    }

    if (out.shouldSpeak === false) {
      return { ok: true, reaction: 'silent', reason: out.reason ?? 'no-comment' };
    }

    const intent = await createIntent({
      projectId: input.projectId,
      authorId: agent.id,
      authorKind: 'agent',
      statement: out.statement,
      type: out.type,
      scope: out.scope,
      weight: out.weight,
      rationale: out.rationale ?? null,
      triggerIntentId: triggerIntent.id,
    });

    await bumpToCollaborating(input.projectId).catch(() => {});

    // 链式 fan-out: Agent 写出新 Intent 后, 让其他 Agent 协作者各自再判断
    // 是否还要接话。chain depth 兜底防无限链, self-trigger 防自我循环。
    // 不 await: 不阻塞当前响应。
    fanOutToOtherAgents({
      projectId: input.projectId,
      newIntentId: intent.id,
      excludeAgentId: agent.id,
      collaborators,
    });

    // Agent 写的 must Intent 也可能引发 tension, 异步检测
    if (intent.weight === 'must') {
      setTimeout(() => {
        import('./detect-tension')
          .then(m => m.detectTensionsForProject(input.projectId))
          .catch(err => console.warn('[detect-tension after react] failed:', err));
      }, 0);
    }

    return { ok: true, reaction: 'spoke', intent };
  } catch (err) {
    return {
      ok: false,
      error: `Agent 反应失败: ${err instanceof Error ? err.message : String(err)}`,
      status: 502,
    };
  }
}

/** 给项目其他 Agent 协作者各开一个 react 协程, 不 await。 */
function fanOutToOtherAgents(opts: {
  projectId: string;
  newIntentId: string;
  excludeAgentId: string;
  collaborators: Employee[];
}) {
  const otherAgents = opts.collaborators.filter(
    c => c.kind === 'agent' && c.id !== opts.excludeAgentId
  );
  for (const a of otherAgents) {
    // setTimeout 0 让当前 response 先返回再启 reactOnce, 避免 await 死锁。
    setTimeout(() => {
      reactOnce({
        projectId: opts.projectId,
        agentEmployeeId: a.id,
        triggerIntentId: opts.newIntentId,
      }).catch(() => {/* 第二跳失败不影响第一跳 */});
    }, 0);
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent 反应超时 ${ms}ms`)), ms)
  );
}
