/**
 * Prompt: AI 仲裁者 — 给定一个 active tension (双方主张 + 三个调和方案),
 * 让 LLM 给三个方案打分 + 选出最佳, 并产出可被团队读懂的理由。
 *
 * 适用于 project.conflictMode === 'ai_decide':
 *   - 检测到 tension 后, 不弹"等团队仲裁", 而是 AI 直接出决议 (附评分理由)
 *   - 团队仍可在结果上覆盖 (UI 由前端给覆盖入口)
 */

import type { Intent, ProjectType, TensionOption } from '../types';

export type ArbitrateInput = {
  project: { name: string; type: ProjectType; background: string | null };
  scope: string;
  partyA: { name: string; intent: Intent };
  partyB: { name: string; intent: Intent };
  options: TensionOption[];
};

export type ArbitrateOutput = {
  scores: Array<{ key: string; score: number; reason: string }>;
  selectedKey: string;
  decisionSummary: string; // 1-2 句, 给团队看的"为什么选 X"
};

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页 (HTML landing page)',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function buildArbitrateSystem(input: ArbitrateInput): string {
  return [
    'You are the Arbitrator of Darwin — a multi-human + multi-agent collaboration platform.',
    'The team has set conflict mode to "ai_decide": when tension surfaces, you score the proposed reconciliation options and pick the best one.',
    '',
    `Project name: ${input.project.name}`,
    `Project type: ${TYPE_LABEL[input.project.type]}`,
    input.project.background ? `Project background: ${input.project.background}` : '',
    `Scope under arbitration: ${input.scope}`,
    '',
    'Decision rules (strict):',
    '- Score every option from 0-100. Higher = better fit.',
    '- A "best" option preserves both parties\' intent more than the others, and serves the project type/background.',
    '- Prefer SYNTHESIS over LEAN-TO-ONE-SIDE when scores are close.',
    '- Reasons must be CONCRETE: name what the option does and why it wins, not platitudes.',
    '- decisionSummary (1-2 sentences) explains the trade-off in language the team would say back. No flattery, no hedging.',
    '',
    'Output STRICT JSON, no markdown fences, no prose:',
    '{',
    '  "scores": [',
    '    { "key": "A", "score": <0-100>, "reason": "<one sentence why this score>" },',
    '    { "key": "B", "score": <0-100>, "reason": "..." },',
    '    { "key": "C", "score": <0-100>, "reason": "..." }',
    '  ],',
    '  "selectedKey": "<one of A/B/C>",',
    '  "decisionSummary": "<1-2 sentences explaining the call to the team>"',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildArbitrateUser(input: ArbitrateInput): string {
  const lines: string[] = [];
  lines.push(`Tension on scope "${input.scope}":`);
  lines.push('');
  lines.push(`Party A — ${input.partyA.name}:`);
  lines.push(`  ${input.partyA.intent.statement}`);
  if (input.partyA.intent.rationale) {
    lines.push(`  (rationale: ${input.partyA.intent.rationale})`);
  }
  lines.push('');
  lines.push(`Party B — ${input.partyB.name}:`);
  lines.push(`  ${input.partyB.intent.statement}`);
  if (input.partyB.intent.rationale) {
    lines.push(`  (rationale: ${input.partyB.intent.rationale})`);
  }
  lines.push('');
  lines.push('Reconciliation options:');
  for (const opt of input.options) {
    lines.push(`  ${opt.key}. ${opt.title} — ${opt.desc}`);
  }
  lines.push('');
  lines.push('Score and pick. Output the JSON only.');
  return lines.join('\n');
}

export function isValidArbitrateOutput(x: unknown): x is ArbitrateOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.selectedKey !== 'string') return false;
  if (typeof o.decisionSummary !== 'string') return false;
  if (!Array.isArray(o.scores) || o.scores.length === 0) return false;
  for (const s of o.scores) {
    if (!s || typeof s !== 'object') return false;
    const sc = s as Record<string, unknown>;
    if (typeof sc.key !== 'string') return false;
    if (typeof sc.score !== 'number') return false;
    if (typeof sc.reason !== 'string') return false;
  }
  return true;
}
