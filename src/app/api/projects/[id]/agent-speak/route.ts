/**
 * POST /api/projects/[id]/agent-speak
 *
 * Body: { agentEmployeeId: string }
 *
 * 让一个 Agent 协作者按其 persona 主动贡献一条 Intent。
 *   - agent 必须是该项目的 collaborator (避免随便指定一个 agent 投影意见)
 *   - LLM 没配 → 502, 不做模板回退 (Agent 发言不能用假数据)
 *   - LLM 失败 → 502 + reason
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getProject, listCollaborators, bumpToCollaborating } from '@/lib/projects';
import { getEmployee } from '@/lib/employees';
import { listIntentsByProject, createIntent } from '@/lib/intents';
import { callLLMJSON, llmProvider } from '@/lib/llm';
import {
  buildAgentSpeakSystem,
  buildAgentSpeakUser,
  isValidAgentSpeakOutput,
} from '@/lib/prompts/agent-speak';

const Body = z.object({
  agentEmployeeId: z.string().min(1),
});

// 60s 而非 30s: cc-switch/Hermes gateway 偶尔 35-45s 才返回,30s 卡得太死。
// 用户在 UI 看到的是 thinkingAgents chip,卡 45s 内可接受。
const SPEAK_TIMEOUT_MS = 60_000;

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
      { ok: false, error: 'LLM 未配置 (ANTHROPIC_API_KEY / OPENAI_API_KEY),Agent 无法发言' },
      { status: 502 }
    );
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json(
      { ok: false, error: 'project not found' },
      { status: 404 }
    );
  }

  const agent = await getEmployee(body.agentEmployeeId);
  if (!agent) {
    return NextResponse.json(
      { ok: false, error: 'agent not found' },
      { status: 404 }
    );
  }
  if (agent.kind !== 'agent') {
    return NextResponse.json(
      { ok: false, error: '只有 Agent 类型员工能用本接口发言' },
      { status: 400 }
    );
  }

  const collaborators = await listCollaborators(projectId);
  const isMember = collaborators.some(c => c.id === agent.id);
  if (!isMember) {
    return NextResponse.json(
      { ok: false, error: `${agent.name} 不在该项目协作者里,先把它加进来` },
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
  };

  try {
    const speak = await Promise.race([
      callLLMJSON<unknown>({
        system: buildAgentSpeakSystem(promptInput),
        user: buildAgentSpeakUser(promptInput),
        cacheSystem: false, // persona 是 system 一部分,会变,不缓存
        maxTokens: 400,
        temperature: 0.65,
      }),
      timeout(SPEAK_TIMEOUT_MS),
    ]);

    if (!isValidAgentSpeakOutput(speak)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Agent 返回 schema 不合法: ${JSON.stringify(speak).slice(0, 160)}`,
        },
        { status: 502 }
      );
    }

    const intent = await createIntent({
      projectId,
      authorId: agent.id,
      authorKind: 'agent',
      statement: speak.statement,
      type: speak.type,
      scope: speak.scope,
      weight: speak.weight,
      rationale: speak.rationale ?? null,
    });

    await bumpToCollaborating(projectId).catch(() => {});

    if (intent.weight === 'must' || intent.weight === 'should' || intent.type === 'Veto') {
      setTimeout(() => {
        import('@/lib/detect-tension')
          .then(m => m.detectTensionsForProject(projectId))
          .catch(err => console.warn('[detect-tension after speak] failed:', err));
      }, 0);
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/');

    return NextResponse.json({ ok: true, intent }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Agent 发言失败: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent 发言超时 ${ms}ms`)), ms)
  );
}
