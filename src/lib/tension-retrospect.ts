/**
 * 冲突复盘 — 服务层。
 *
 * 触发: resolve route 的 after() 块, fire-and-forget。
 * 失败不阻断 resolve (after 已返回响应)。复盘缺失时 UI / timeline 自然降级。
 *
 * Server-only。
 */

import { getTension, attachRetrospect } from './tensions';
import { getIntent } from './intents';
import { getEmployee } from './employees';
import { findThreadByTension, listMessages } from './threads';
import { getProject } from './projects';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildTensionRetrospectSystem,
  buildTensionRetrospectUser,
  isValidTensionRetrospectOutput,
  type TensionRetrospectInput,
  type ThreadMessageLite,
} from './prompts/tension-retrospect';

const RETROSPECT_TIMEOUT_MS = 25_000;
const SUMMARY_MAX_CHARS = 200;
const LESSON_MAX_CHARS = 36;  // 30 字 + 容错

export type GenerateRetrospectResult =
  | { ok: true; retrospect: NonNullable<NonNullable<Awaited<ReturnType<typeof getTension>>>['resolution']>['retrospect'] }
  | { ok: false; error: string };

export async function generateRetrospect(tensionId: string): Promise<GenerateRetrospectResult> {
  const tension = await getTension(tensionId);
  if (!tension) return { ok: false, error: 'tension not found' };
  if (tension.status !== 'resolved' || !tension.resolution) {
    return { ok: false, error: 'tension not resolved yet' };
  }
  if (!llmProvider()) return { ok: false, error: 'no LLM provider' };

  const project = await getProject(tension.projectId);
  if (!project) return { ok: false, error: 'project not found' };

  // 拉两边 intent + 各自作者
  const intents = await Promise.all(tension.intentIds.map(getIntent));
  const sideIntents: TensionRetrospectInput['sideIntents'] = [];
  for (const intent of intents) {
    if (!intent) continue;
    const author = await getEmployee(intent.authorId);
    if (!author) continue;
    sideIntents.push({
      intent: {
        id: intent.id,
        statement: intent.statement,
        type: intent.type,
        scope: intent.scope,
        weight: intent.weight,
      },
      author: {
        id: author.id,
        name: author.name,
        role: author.role,
        kind: author.kind,
      },
    });
  }
  if (sideIntents.length < 2) {
    return { ok: false, error: 'cannot retrospect: fewer than 2 sides' };
  }

  // 拉 thread + messages (可能没有)
  let threadMessages: ThreadMessageLite[] = [];
  const thread = await findThreadByTension(tensionId).catch(() => null);
  if (thread) {
    const msgs = await listMessages(thread.id).catch(() => []);
    // 拿 author name (employees lookup 已经多余 — message 里没存 name, 需要回查)
    const authorIds = new Set(msgs.map(m => m.authorId));
    const authorMap = new Map<string, string>();
    for (const aid of authorIds) {
      if (aid === 'system') { authorMap.set(aid, '系统'); continue; }
      const emp = await getEmployee(aid).catch(() => null);
      authorMap.set(aid, emp?.name ?? aid.slice(0, 8));
    }
    threadMessages = msgs.map(m => ({
      authorName: authorMap.get(m.authorId) ?? '?',
      authorKind: m.authorKind === 'system' ? 'human' : m.authorKind,
      body: m.body,
      isDecision: m.isDecision,
      createdAt: m.createdAt,
    }));
  }

  const promptInput: TensionRetrospectInput = {
    tension: {
      scope: tension.scope,
      variant: tension.variant,
      options: tension.options,
      createdAt: tension.createdAt,
      resolvedAt: tension.resolvedAt ?? null,
      resolution: tension.resolution,
    },
    sideIntents,
    threadMessages,
    projectName: project.name,
  };

  let parsed;
  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildTensionRetrospectSystem(promptInput),
        user: buildTensionRetrospectUser(promptInput),
        cacheSystem: false,
        maxTokens: 500,
        temperature: 0.3,
        tier: 'full',
      }),
      timeout(RETROSPECT_TIMEOUT_MS),
    ]);
    if (!isValidTensionRetrospectOutput(out)) {
      return { ok: false, error: 'LLM output invalid' };
    }
    parsed = out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 清洗 + 截断
  const retrospect = {
    winnerSide: parsed.winnerSide.trim(),
    yieldedBy: parsed.yieldedBy.map(s => s.trim()).filter(Boolean),
    summary: parsed.summary.trim().slice(0, SUMMARY_MAX_CHARS),
    lesson: parsed.lesson.trim().slice(0, LESSON_MAX_CHARS),
    durationMinutes: Math.max(0, Math.round(parsed.durationMinutes)),
    messageCount: Math.max(0, Math.round(parsed.messageCount)),
  };

  await attachRetrospect(tensionId, retrospect);
  return { ok: true, retrospect };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`tension-retrospect 超时 ${ms}ms`)), ms)
  );
}
