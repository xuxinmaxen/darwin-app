/**
 * POST /api/projects/[id]/agent-react
 *
 * Body: { agentEmployeeId, triggerIntentId }
 *
 * 让一个 Agent 协作者「看到」某条触发 Intent 后,自己判断是否要接话。
 * 跟 agent-speak 不同:
 *   - 不强制发言, LLM 输出 shouldSpeak: false 时返回 ok=true + reaction='silent'
 *   - 不阻塞主流程,客户端 fire-and-forget 即可
 *   - 不会触发自身链式反应 (Agent 看到自己的 Intent 不再 react)
 *
 * 返回:
 *   { ok: true, reaction: 'spoke', intent: {...} }
 *   { ok: true, reaction: 'silent', reason?: '...' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getProject, listCollaborators, bumpToCollaborating } from '@/lib/projects';
import { getEmployee } from '@/lib/employees';
import {
  listIntentsByProject,
  createIntent,
  getIntent,
} from '@/lib/intents';
import { callLLMJSON, llmProvider } from '@/lib/llm';
import {
  buildAgentReactSystem,
  buildAgentReactUser,
  isValidAgentReactOutput,
} from '@/lib/prompts/agent-react';

const Body = z.object({
  agentEmployeeId: z.string().min(1),
  triggerIntentId: z.string().min(1),
});

const REACT_TIMEOUT_MS = 25_000;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  if (!llmProvider()) {
    return NextResponse.json(
      { ok: false, error: 'LLM 未配置' },
      { status: 502 }
    );
  }

  const [project, agent, triggerIntent] = await Promise.all([
    getProject(projectId),
    getEmployee(body.agentEmployeeId),
    getIntent(body.triggerIntentId),
  ]);

  if (!project) {
    return NextResponse.json({ ok: false, error: 'project not found' }, { status: 404 });
  }
  if (!agent || agent.kind !== 'agent') {
    return NextResponse.json({ ok: false, error: 'agent not found' }, { status: 404 });
  }
  if (!triggerIntent || triggerIntent.projectId !== projectId) {
    return NextResponse.json(
      { ok: false, error: 'trigger intent not in this project' },
      { status: 400 }
    );
  }

  // 不让 Agent 反应自己刚说过的 Intent (闭环)
  if (triggerIntent.authorId === agent.id) {
    return NextResponse.json({ ok: true, reaction: 'silent', reason: 'self-trigger' });
  }

  const collaborators = await listCollaborators(projectId);
  const isMember = collaborators.some(c => c.id === agent.id);
  if (!isMember) {
    return NextResponse.json(
      { ok: false, error: `${agent.name} 不在该项目协作者里` },
      { status: 400 }
    );
  }

  const existingIntents = await listIntentsByProject(projectId);
  const promptInput = {
    agent,
    project: {
      name: project.name,
      type: project.type,
      background: project.background ?? null,
    },
    collaborators,
    existingIntents,
    triggerIntent,
  };

  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentReactSystem(promptInput),
        user: buildAgentReactUser(promptInput),
        cacheSystem: false,
        maxTokens: 400,
        temperature: 0.4,
      }),
      timeout(REACT_TIMEOUT_MS),
    ]);

    if (!isValidAgentReactOutput(out)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Agent 返回 schema 不合法: ${JSON.stringify(out).slice(0, 160)}`,
        },
        { status: 502 }
      );
    }

    if (out.shouldSpeak === false) {
      return NextResponse.json({
        ok: true,
        reaction: 'silent',
        reason: out.reason,
      });
    }

    const intent = await createIntent({
      projectId,
      authorId: agent.id,
      authorKind: 'agent',
      statement: out.statement,
      type: out.type,
      scope: out.scope,
      weight: out.weight,
      rationale: out.rationale ?? null,
    });

    await bumpToCollaborating(projectId).catch(() => {});

    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/');

    return NextResponse.json(
      { ok: true, reaction: 'spoke', intent },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Agent 反应失败: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent 反应超时 ${ms}ms`)), ms)
  );
}
