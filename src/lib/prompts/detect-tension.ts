/**
 * Prompt: 给定一个 scope 下的两条 (或更多) must Intent, 判断它们是否语义对立。
 *
 * 核心约束:
 *   - 默认假设兼容 (返 inTension=false)
 *   - 仅在「同时全部满足会矛盾」时返 inTension=true
 *   - 检测到对立时, 必须输出 3 个调和方案 (不可少于 3)
 */

import type { Intent, ProjectType } from '../types';

export type DetectTensionInput = {
  scope: string;
  intents: Intent[];     // 该 scope 下所有 must Intent
  project: {
    name: string;
    type: ProjectType;
    background: string | null;
  };
};

export type DetectTensionOutput =
  | { inTension: false; reason: string }
  | {
      inTension: true;
      summary: string;
      partyAIntentId: string;
      partyBIntentId: string;
      options: Array<{ key: string; title: string; desc: string }>;
    };

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页 (HTML landing page)',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function buildDetectTensionSystem(input: DetectTensionInput): string {
  return [
    'You are the Tension Detector of Darwin — a multi-human + multi-agent collaboration platform whose first principle is "the unit of collaboration is Intent, not output".',
    '',
    'Your job: given a set of Intents (mixed weights and types — must, should, and Veto), find any PAIR that is semantically incompatible. If found, surface the conflict with 3 reconciliation options for the team to arbitrate. Pick ONE most representative pair if multiple conflicts exist.',
    '',
    `Project name: ${input.project.name}`,
    `Project type: ${TYPE_LABEL[input.project.type]}`,
    input.project.background ? `Project background: ${input.project.background}` : '',
    `Scope under inspection: ${input.scope}`,
    '',
    'Input shape:',
    '- Each intent line has [type · author] tags. Type=Veto means the author is explicitly opposing/forbidding something — Veto intents conflict with any intent that asserts the thing they forbid, regardless of declared scope. Treat a "veto-cross:" scope name as a signal that the FIRST intent is a Veto being checked against intents from OTHER scopes.',
    '- Authors can be Human or Agent. A Human Veto contradicting an Agent recommendation is a real tension — surface it.',
    '- Weights (must/should) are advisory. Even a should-level Agent recommendation that directly contradicts a must-level Human Veto IS a tension.',
    '',
    'Decision rule:',
    '- DEFAULT to "compatible" (inTension=false). Most Intents COMPLEMENT each other.',
    '- Return inTension=true ONLY when a pair makes opposite assertions about the SAME concrete decision (e.g. "CTA links TO X" vs "CTA must NOT link to X"; "hero is dark" vs "hero is light"). Not when they merely emphasize different things.',
    '- A Veto-type intent ("don\'t / never / not") that names a concrete target is a tension with any intent (any weight) that asserts that target. Don\'t require the other party to be must-level.',
    '- A "scoped Veto" can collide with a "navigation"/"global" assertion if they\'re talking about the same UI element — judge by content, not scope label.',
    '',
    'Examples of REAL tension (return inTension=true):',
    '  • "传达技术专业感" vs "视觉冲击力" on hero — restraint vs impact',
    '  • "免费档要无水印" vs "免费档要驱动升级" on pricing.free — generosity vs conversion',
    '  • [Veto · Human] "顶部/页尾 CTA 不要指向 wohi 的申请或登录入口" vs [should · Agent] "运营侧建议顶部/页尾 CTA 指向 wohi 的申请或登录入口" — direct contradiction even though weights differ',
    '',
    'Examples of FALSE tension (return inTension=false):',
    '  • "传达技术专业感" + "目标用户是 CTO" → reinforce each other',
    '  • "三档定价" + "企业版突出 SSO" → orthogonal',
    '  • "深色配色" + "大字标题" → can coexist',
    '',
    'When inTension=true, output 3 reconciliation options (key=A,B,C):',
    '  - Option A: usually a synthesis path (both intents partially satisfied)',
    '  - Option B: lean toward party A',
    '  - Option C: lean toward party B',
    '  - Each option: title (≤16 字) + desc (1-2 sentences explaining the trade-off)',
    '  - Options must be CONCRETE design directions, not platitudes',
    '',
    'Output STRICT JSON, no markdown fences, no prose:',
    '',
    'If compatible:',
    '{ "inTension": false, "reason": "<one short sentence why they coexist>" }',
    '',
    'If in tension:',
    '{',
    '  "inTension": true,',
    '  "summary": "<one sentence: X vs Y on this scope>",',
    '  "partyAIntentId": "<intent_id>",',
    '  "partyBIntentId": "<intent_id>",',
    '  "options": [',
    '    { "key": "A", "title": "...", "desc": "..." },',
    '    { "key": "B", "title": "...", "desc": "..." },',
    '    { "key": "C", "title": "...", "desc": "..." }',
    '  ]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildDetectTensionUser(input: DetectTensionInput): string {
  const lines: string[] = [];
  const isCrossScope = input.scope.startsWith('veto-cross:');
  lines.push(
    isCrossScope
      ? `Cross-scope tension scan — primary Veto intent first, then candidates from OTHER scopes. Scope label: "${input.scope}"`
      : `Intents on scope "${input.scope}" (mixed weights — must/should — and types — Goal/Constraint/Veto/etc):`
  );
  lines.push('');
  for (let i = 0; i < input.intents.length; i++) {
    const it = input.intents[i];
    const author = it.authorKind === 'agent' ? 'Agent' : 'Human';
    lines.push(
      `${i + 1}. id=${it.id} [${it.type} · weight=${it.weight} · scope=${it.scope} · ${author}] ${it.statement}`
    );
  }
  lines.push('');
  lines.push('Decide: are these in real tension? Output the JSON only.');
  return lines.join('\n');
}

export function isValidDetectOutput(x: unknown): x is DetectTensionOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.inTension === false) return true;
  if (o.inTension !== true) return false;
  if (typeof o.summary !== 'string') return false;
  if (typeof o.partyAIntentId !== 'string') return false;
  if (typeof o.partyBIntentId !== 'string') return false;
  if (!Array.isArray(o.options) || o.options.length < 3) return false;
  for (const opt of o.options) {
    if (!opt || typeof opt !== 'object') return false;
    const op = opt as Record<string, unknown>;
    if (typeof op.key !== 'string') return false;
    if (typeof op.title !== 'string') return false;
    if (typeof op.desc !== 'string') return false;
  }
  return true;
}
