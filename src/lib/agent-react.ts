/**
 * Agent 接话核心 logic — 给一个 Agent + 一条 trigger Intent, 决定 spoke/silent。
 *
 * Route handler (`/api/projects/:id/agent-react`) 是这个 helper 的 HTTP 包装。
 * 前端 IntentForm 用户加 intent 时会 client-side 并发触发每个 agent 走这条 route,
 * 所以 fan-out 由前端完成, 服务端只 react 一次, 不递归触发其他 agent
 * (历史上有过 server fanOutToOtherAgents, 导致 N agent → N² LLM 调用 + 第二跳
 * intent 不可见, 已移除)。
 *
 * Server-only。
 */

import { after } from 'next/server';
import type { Intent } from './types';
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

/** human → react Agent 最多走几跳。链超过这个深度就强制沉默。
 * 设为 1: Agent 只对真人输入做一次反应,不会再串联反应其他 Agent 的输出。
 * 这样意图源头只来自"真人主动输入" + "真人输入触发的一轮 agent 反应",
 * 避免后台静默继续合成 v2/v3/... 直到 chain 自然终止。 */
export const MAX_CHAIN_DEPTH = 1;

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
  const { data: dupData } = await db()
    .from('intents').select('id').eq('author_id', agent.id)
    .eq('trigger_intent_id', triggerIntent.id).limit(1).maybeSingle();
  if (dupData) {
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
        tier: 'fast',
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

    // 不再 server 端 fan-out 给其他 agent — 前端 IntentForm 已经 client-side
    // 并发触发每个 agent 走这条 route, 再 fan-out 一次就是 N² LLM 调用 + 第二跳
    // intent 在前端不可见 (response 不回前端, 用户得刷新才能看到)。

    // Agent 写的 must Intent 也可能引发 tension, 异步检测
    // 用 after() 而不是 setTimeout, 见 src/app/api/projects/[id]/intents/route.ts 注释。
    if (intent.weight === 'must') {
      after(async () => {
        try {
          const m = await import('./detect-tension');
          await m.detectTensionsForProject(input.projectId);
        } catch (err) {
          console.warn('[detect-tension after react] failed:', err);
        }
      });
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

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent 反应超时 ${ms}ms`)), ms)
  );
}
