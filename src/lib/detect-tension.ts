/**
 * Tension 检测核心 — 给定一个项目, 扫描 must-level Intent, 按 scope 分组,
 * 对每个 scope > 1 条 must Intent 调 LLM 判断是否对立。
 *
 * 触发点:
 *   - 用户加 Intent 后 (fire-and-forget)
 *   - Agent react 写完 Intent 后 (fire-and-forget)
 *
 * 写入:
 *   - 检测到对立 → createTension + 推 project.status='tension'
 *   - 已有相同 fingerprint 的 active tension → 跳过 (去重)
 *
 * Server-only。
 */

import type { Intent } from './types';
import { db } from './db';
import { getProject } from './projects';
import { listIntentsByProject } from './intents';
import {
  listActiveTensions,
  findActiveTensionFor,
  createTension,
} from './tensions';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildDetectTensionSystem,
  buildDetectTensionUser,
  isValidDetectOutput,
} from './prompts/detect-tension';

const DETECT_TIMEOUT_MS = 20_000;

export async function detectTensionsForProject(
  projectId: string
): Promise<{ created: number }> {
  if (!llmProvider()) return { created: 0 };

  const project = await getProject(projectId);
  if (!project) return { created: 0 };

  const intents = await listIntentsByProject(projectId);
  // 只看 must 级
  const musts = intents.filter(i => i.weight === 'must');

  // 按 scope 分组 (用 scope 头作为 key, e.g. "pricing.team" → "pricing")
  const groups = new Map<string, Intent[]>();
  for (const i of musts) {
    if (i.scope === 'global') continue; // global 跟谁都不对立
    const head = i.scope.split('.')[0];
    const list = groups.get(head) ?? [];
    list.push(i);
    groups.set(head, list);
  }

  let created = 0;
  for (const [scope, scopedIntents] of groups) {
    if (scopedIntents.length < 2) continue;

    // 已有 active tension 覆盖相同 intentIds 集合 → 跳过
    const existing = await findActiveTensionFor(
      projectId,
      scope,
      scopedIntents.map(i => i.id)
    );
    if (existing) continue;

    const ok = await detectScopeTension({
      project: {
        name: project.name,
        type: project.type,
        background: project.background ?? null,
      },
      scope,
      intents: scopedIntents,
      conflictMode: project.conflictMode,
    });
    if (ok) created += 1;
  }

  // 有 active tension → project status = 'tension'
  if (created > 0) {
    db()
      .prepare(
        `UPDATE projects SET status = 'tension', updated_at = ?
         WHERE id = ?
           AND status IN ('draft', 'collaborating')`
      )
      .run(new Date().toISOString(), projectId);
  }

  return { created };
}

async function detectScopeTension(args: {
  project: { name: string; type: 'html' | 'ppt' | 'doc' | 'design'; background: string | null };
  scope: string;
  intents: Intent[];
  conflictMode: 'discuss' | 'ai_decide';
}): Promise<boolean> {
  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildDetectTensionSystem(args),
        user: buildDetectTensionUser(args),
        cacheSystem: false,
        maxTokens: 600,
        temperature: 0.2,
      }),
      timeout(DETECT_TIMEOUT_MS),
    ]);

    if (!isValidDetectOutput(out)) return false;
    if (out.inTension === false) return false;

    // 校验 partyA/B id 在 intents 里
    const ids = new Set(args.intents.map(i => i.id));
    if (!ids.has(out.partyAIntentId) || !ids.has(out.partyBIntentId)) return false;

    // 决定 variant
    const partyA = args.intents.find(i => i.id === out.partyAIntentId)!;
    const partyB = args.intents.find(i => i.id === out.partyBIntentId)!;
    const variant: 'human' | 'agents' =
      partyA.authorKind === 'agent' && partyB.authorKind === 'agent'
        ? 'agents'
        : 'human';

    const created = await createTension({
      projectId: args.intents[0].projectId,
      scope: args.scope,
      intentIds: [out.partyAIntentId, out.partyBIntentId],
      variant,
      options: out.options,
    });

    // ai_decide 模式: 检测出 tension 后立刻 fire-and-forget 让 AI 仲裁
    if (args.conflictMode === 'ai_decide') {
      // 动态 import 避免 detect → arbitrate → detect 的循环引用风险
      setTimeout(() => {
        import('./arbitrate-tension')
          .then(m => m.arbitrateTension(created.id))
          .then(r => {
            if (!r.ok) {
              console.warn('[arbitrate-tension] auto run failed:', r.error);
            }
          })
          .catch(err => console.warn('[arbitrate-tension] threw:', err));
      }, 0);
    }

    return true;
  } catch (err) {
    console.warn('[detect-tension] LLM path failed:', err);
    return false;
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`detect-tension 超时 ${ms}ms`)), ms)
  );
}

/** 解决 tension 后, 把项目状态从 'tension' 推回 'collaborating' (如果没其他 active tension) */
export async function maybeBackToCollaborating(projectId: string): Promise<void> {
  const active = await listActiveTensions(projectId);
  if (active.length === 0) {
    db()
      .prepare(
        `UPDATE projects SET status = 'collaborating', updated_at = ?
         WHERE id = ? AND status = 'tension'`
      )
      .run(new Date().toISOString(), projectId);
  }
}
