/**
 * Prompt: 在讨论 thread 进行中, AI 调和者判断"团队是否已对某个方案达成一致"。
 *
 * 设计原则:
 *   - 默认沉默 (reached=false)。误判会替团队做决定, 风险大。
 *   - 必须看到 ≥2 个不同 author 显性表态 (语气含倾向 / 同意 / 接受)
 *   - 主张反对、犹豫、提新方案的 → reached=false
 *   - 仅在所有发言者都收敛到 同一 option 才 reached=true
 *
 * 输出 selectedKey 必须在 options 列表里 (A/B/C)。
 */

import type { TensionOption, ThreadMessage } from '../types';

export type ConsensusInput = {
  scope: string;
  options: TensionOption[];
  /** thread 全部消息(按时间顺序), 含 system / human / agent */
  messages: Pick<ThreadMessage, 'authorKind' | 'authorId' | 'body' | 'isDecision'>[];
  /** 项目 Owner 名字 (语境用) */
  ownerName: string;
};

export type ConsensusOutput =
  | { reached: false; reason: string }
  | {
      reached: true;
      selectedKey: string;
      summary: string;          // ≤ 80 字, 团队会照着说回来的口吻
      confidence: number;       // 0-100
    };

export function buildConsensusSystem(input: ConsensusInput): string {
  return [
    'You are the Consensus Detector of Darwin — a multi-human + multi-agent collaboration platform.',
    '',
    `Discussion scope: ${input.scope}`,
    `Project owner: ${input.ownerName}`,
    '',
    'Rule (strict, default to reached=false):',
    '- Output reached=true ONLY if ≥2 distinct authors clearly converged to the SAME option.',
    '- "我倾向 A" / "我接受 A" / "就 A 吧" 等显性同意 → 算表态.',
    '- "A 也行" / "都可以" / 含糊 → 不算表态, reached=false.',
    '- 任何人提出新方案、反驳、要求改 option, 在那之后必须有所有人重新一致, 否则 reached=false.',
    '- 如果只有一个 author 在发言 → reached=false (一个人不能代表团队).',
    '',
    'Output STRICT JSON, no markdown fences:',
    '{ "reached": false, "reason": "<one sentence>" }',
    '或',
    '{ "reached": true, "selectedKey": "A|B|C", "summary": "<≤80 字, 团队达成一致的内容>", "confidence": <60-100> }',
    '',
    `Available option keys: ${input.options.map(o => o.key).join(', ')}.`,
    '',
    'Confidence < 70 → 改成 reached=false. 一致需要确凿。',
  ].join('\n');
}

export function buildConsensusUser(input: ConsensusInput): string {
  const lines: string[] = [];
  lines.push('Tension reconciliation options:');
  for (const o of input.options) {
    lines.push(`  ${o.key}. ${o.title} — ${o.desc}`);
  }
  lines.push('');
  lines.push('Discussion (oldest → newest):');
  // 跳过 system isDecision 决议消息(本身就是仲裁结果不能当作"达成一致"的依据)
  // 也跳过开场 system 消息(只是描述冲突)
  const useful = input.messages.filter(
    m => !(m.authorKind === 'system' && m.isDecision)
  );
  for (const m of useful.slice(-20)) {
    lines.push(`  - (${m.authorKind} · ${m.authorId.slice(0, 6)}) ${m.body}`);
  }
  lines.push('');
  lines.push('Decide. Output the JSON only.');
  return lines.join('\n');
}

export function isValidConsensusOutput(x: unknown): x is ConsensusOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.reached === false) return true;
  if (o.reached !== true) return false;
  if (typeof o.selectedKey !== 'string') return false;
  if (typeof o.summary !== 'string' || !o.summary.trim()) return false;
  if (typeof o.confidence !== 'number') return false;
  return true;
}
