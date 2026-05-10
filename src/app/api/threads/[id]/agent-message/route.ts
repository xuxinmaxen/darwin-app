/**
 * POST /api/threads/[id]/agent-message
 *
 * Body: { agentEmployeeId }
 *
 * 让指定 Agent 在这个 thread 里发一条 message。LLM 决定说不说;
 * 觉得没东西说就 ok=true + said=false。
 *
 * 触发时机:
 *   - thread 由 tension 创建 + tension 双方有 agent → ProjectShell fire-and-forget
 *   - 用户在 drawer 里 @-tag (后续可加 UI)
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getThread, listMessages, createMessage } from '@/lib/threads';
import { getProject } from '@/lib/projects';
import { getEmployee } from '@/lib/employees';
import { getTension } from '@/lib/tensions';
import { getIntent } from '@/lib/intents';
import { callLLMJSON, llmProvider } from '@/lib/llm';
import {
  buildAgentThreadSystem,
  buildAgentThreadUser,
  isValidAgentThreadOutput,
  type AgentThreadInput,
} from '@/lib/prompts/agent-thread-message';

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  agentEmployeeId: z.string().min(1),
});

const TIMEOUT_MS = 25_000;

export async function POST(req: NextRequest, { params }: Params) {
  const { id: threadId } = await params;
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
    return NextResponse.json({ ok: false, error: 'no LLM provider' }, { status: 502 });
  }

  const thread = await getThread(threadId);
  if (!thread) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }
  if (thread.status === 'resolved') {
    return NextResponse.json({ ok: true, said: false, reason: 'thread resolved' });
  }

  const agent = await getEmployee(body.agentEmployeeId);
  if (!agent || agent.kind !== 'agent') {
    return NextResponse.json(
      { ok: false, error: 'agent not found or not an agent' },
      { status: 400 }
    );
  }

  const project = await getProject(thread.projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: 'project not found' }, { status: 404 });
  }

  // Tension 上下文
  let tensionCtx: AgentThreadInput['tension'] = null;
  if (thread.tensionId) {
    const tension = await getTension(thread.tensionId);
    if (tension && tension.intentIds.length >= 2) {
      const [intentA, intentB] = await Promise.all([
        getIntent(tension.intentIds[0]),
        getIntent(tension.intentIds[1]),
      ]);
      if (intentA && intentB) {
        const [empA, empB] = await Promise.all([
          getEmployee(intentA.authorId),
          getEmployee(intentB.authorId),
        ]);
        tensionCtx = {
          partyA: { name: empA?.name ?? '?', intent: intentA },
          partyB: { name: empB?.name ?? '?', intent: intentB },
          options: tension.options,
        };
      }
    }
  }

  const messages = await listMessages(threadId);

  // 守卫: 这个 agent 已经在 thread 里发过言 → 跳过 (避免被多次 fire 重复调)
  const alreadySpoke = messages.some(
    m => m.authorId === agent.id && m.authorKind === 'agent'
  );
  if (alreadySpoke) {
    return NextResponse.json({
      ok: true,
      said: false,
      reason: 'agent already spoke in this thread',
    });
  }

  const input: AgentThreadInput = {
    agent,
    project: {
      name: project.name,
      type: project.type,
      background: project.background ?? null,
    },
    scope: thread.scope,
    tension: tensionCtx,
    recentMessages: messages.map(m => ({
      authorKind: m.authorKind,
      body: m.body,
      isDecision: m.isDecision,
    })),
  };

  let parsed;
  try {
    parsed = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentThreadSystem(input),
        user: buildAgentThreadUser(input),
        cacheSystem: false,
        maxTokens: 250,
        temperature: 0.6,
      }),
      timeout(TIMEOUT_MS),
    ]);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  if (!isValidAgentThreadOutput(parsed)) {
    return NextResponse.json(
      { ok: false, error: 'LLM output invalid' },
      { status: 502 }
    );
  }
  if (parsed.say === false) {
    return NextResponse.json({ ok: true, said: false, reason: parsed.reason });
  }

  const message = await createMessage({
    threadId,
    authorId: agent.id,
    authorKind: 'agent',
    body: parsed.statement.trim().slice(0, 400),
    isDecision: false,
  });

  revalidatePath(`/projects/${thread.projectId}`);
  return NextResponse.json({ ok: true, said: true, message });
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`agent-thread-message 超时 ${ms}ms`)), ms)
  );
}
