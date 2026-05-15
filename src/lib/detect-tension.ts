/**
 * Tension 检测核心 — 给定一个项目, 扫描候选 Intent, 按 scope 分组, 调 LLM 判断是否对立。
 *
 * 候选规则:
 *   - 主候选: 所有 must-level + 所有 Veto-type (Veto 是显式反对, 不看权重)
 *   - 副候选: should-level 意图, 但只在该 scope 组里已有 ≥1 个主候选时才进组
 *     (避免 should-only 组制造噪音, 但当 should 直接顶撞 must 时能被发现)
 *
 * Scope 分组规则:
 *   - 同时按 "." 和 "/" 拆头, 一条意图可同时归到多个 scope 头
 *     (如 "header.cta/footer.cta" 同时进 header 和 footer 组)
 *   - global 单独成组
 *
 * Veto 跨域扫描:
 *   - 每个 Veto 意图, 除了进自己 scope 组, 还和 "其它 scope 组里的主候选" 凑一组单独 LLM 检查
 *     处理「用户 Veto 在 scope=header.cta, 但 Agent 提议在 scope=navigation 提『顶部 CTA 指向 X』」这种跨 scope 直接顶撞
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
  findAnyTensionFor,
  createTension,
} from './tensions';
import { callLLMJSON, llmProvider } from './llm';
import {
  buildDetectTensionSystem,
  buildDetectTensionUser,
  isValidDetectOutput,
} from './prompts/detect-tension';

const DETECT_TIMEOUT_MS = 20_000;

/** scope 字符串 → 可能的多个 scope 头 (按 '.' 和 '/' 拆) */
function scopeHeads(scope: string): string[] {
  if (!scope || scope === 'global') return ['global'];
  // "header.cta/footer.cta" → ["header.cta", "footer.cta"] → 各取 split('.')[0] → ["header", "footer"]
  const parts = scope.split('/').map(s => s.trim()).filter(Boolean);
  const heads = new Set<string>();
  for (const p of parts) {
    const head = p.split('.')[0].trim();
    if (head) heads.add(head);
  }
  return heads.size ? Array.from(heads) : [scope];
}

function isPrimary(i: Intent): boolean {
  // 主候选: must-level 或 Veto-type
  return i.weight === 'must' || i.type === 'Veto';
}

function isSecondary(i: Intent): boolean {
  // 副候选: should-level (含 should + Constraint/Preference/etc), 不含 could
  return i.weight === 'should';
}

export async function detectTensionsForProject(
  projectId: string
): Promise<{ created: number }> {
  if (!llmProvider()) return { created: 0 };

  const project = await getProject(projectId);
  if (!project) return { created: 0 };

  const intents = await listIntentsByProject(projectId);
  const primaries = intents.filter(isPrimary);
  const secondaries = intents.filter(isSecondary);

  // 按 scope 头分组 (允许一条意图进多个组)
  const groups = new Map<string, { primary: Intent[]; secondary: Intent[] }>();
  for (const i of primaries) {
    for (const head of scopeHeads(i.scope)) {
      const g = groups.get(head) ?? { primary: [], secondary: [] };
      g.primary.push(i);
      groups.set(head, g);
    }
  }
  for (const i of secondaries) {
    for (const head of scopeHeads(i.scope)) {
      const g = groups.get(head);
      // 只在组里已有主候选时, secondary 才进
      if (!g) continue;
      g.secondary.push(i);
    }
  }

  let created = 0;
  const reportedPairs = new Set<string>(); // 跨 detect 调用内自去重 (排序后的 a:b)
  const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (const [head, group] of groups) {
    const scopedIntents = [...group.primary, ...group.secondary];
    if (scopedIntents.length < 2) continue;

    const existing = await findAnyTensionFor(
      projectId, head, scopedIntents.map(i => i.id)
    );
    if (existing) continue;

    const detected = await detectScopeTension({
      project: {
        name: project.name,
        type: project.type,
        background: project.background ?? null,
      },
      scope: head,
      intents: scopedIntents,
      conflictMode: project.conflictMode,
      reportedPairs,
      pairKey,
    });
    if (detected) created += 1;
  }

  // === Veto 跨 scope 扫描 ===
  // 每个 Veto 在其它 scope 组里, 是否直接顶撞别处的主候选 / should?
  const vetos = intents.filter(i => i.type === 'Veto');
  for (const veto of vetos) {
    const vetoHeads = new Set(scopeHeads(veto.scope));
    // 收集其它 scope 头里的主候选 + should
    const otherCandidates: Intent[] = [];
    const seen = new Set<string>([veto.id]);
    for (const [head, group] of groups) {
      if (vetoHeads.has(head)) continue;
      for (const i of [...group.primary, ...group.secondary]) {
        if (seen.has(i.id)) continue;
        seen.add(i.id);
        otherCandidates.push(i);
      }
    }
    if (otherCandidates.length === 0) continue;

    const crossScope = `veto-cross:${veto.scope}`;
    const allForCheck = [veto, ...otherCandidates];

    // 已有 tension 覆盖完全相同集合? 跳
    const existing = await findAnyTensionFor(
      projectId, crossScope, allForCheck.map(i => i.id)
    );
    if (existing) continue;

    const detected = await detectScopeTension({
      project: {
        name: project.name,
        type: project.type,
        background: project.background ?? null,
      },
      scope: crossScope,
      intents: allForCheck,
      conflictMode: project.conflictMode,
      reportedPairs,
      pairKey,
    });
    if (detected) created += 1;
  }

  if (created > 0) {
    await db().from('projects')
      .update({ status: 'tension', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .in('status', ['draft', 'collaborating']);
  }

  return { created };
}

async function detectScopeTension(args: {
  project: { name: string; type: 'html' | 'ppt' | 'doc' | 'design'; background: string | null };
  scope: string;
  intents: Intent[];
  conflictMode: 'discuss' | 'ai_decide';
  reportedPairs: Set<string>;
  pairKey: (a: string, b: string) => string;
}): Promise<boolean> {
  try {
    const out = await Promise.race([
      callLLMJSON<unknown>({
        system: buildDetectTensionSystem(args),
        user: buildDetectTensionUser(args),
        cacheSystem: false,
        maxTokens: 600,
        temperature: 0.2,
        tier: 'fast',
      }),
      timeout(DETECT_TIMEOUT_MS),
    ]);

    if (!isValidDetectOutput(out)) return false;
    if (out.inTension === false) return false;

    const ids = new Set(args.intents.map(i => i.id));
    if (!ids.has(out.partyAIntentId) || !ids.has(out.partyBIntentId)) return false;

    // 一个意图对在多个 scope head 下都被检测到时, 只建一次 tension
    const pk = args.pairKey(out.partyAIntentId, out.partyBIntentId);
    if (args.reportedPairs.has(pk)) return false;

    const partyA = args.intents.find(i => i.id === out.partyAIntentId)!;
    const partyB = args.intents.find(i => i.id === out.partyBIntentId)!;
    const variant: 'human' | 'agents' =
      partyA.authorKind === 'agent' && partyB.authorKind === 'agent'
        ? 'agents'
        : 'human';

    const pickedIds = [out.partyAIntentId, out.partyBIntentId];
    const recheck = await findAnyTensionFor(
      args.intents[0].projectId, args.scope, pickedIds
    );
    if (recheck) {
      args.reportedPairs.add(pk);
      return false;
    }

    const created = await createTension({
      projectId: args.intents[0].projectId,
      scope: args.scope,
      intentIds: pickedIds,
      variant,
      options: out.options,
    });
    args.reportedPairs.add(pk);

    if (args.conflictMode === 'ai_decide') {
      setTimeout(() => {
        import('./arbitrate-tension')
          .then(m => m.arbitrateTension(created.id))
          .then(r => {
            if (!r.ok) console.warn('[arbitrate-tension] auto run failed:', r.error);
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
    await db().from('projects')
      .update({ status: 'collaborating', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('status', 'tension');
  }
}
