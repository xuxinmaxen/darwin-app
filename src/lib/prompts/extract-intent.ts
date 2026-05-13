/**
 * Prompt: extract structured Intent from a single statement.
 *
 * Design rules:
 * - System prompt is stable (cacheable).
 * - Output is strict JSON (no markdown, no commentary).
 * - Project context (type, background) is appended to system prompt.
 */

import type { ExtractedIntent, ProjectType } from '../types';

export type ExtractContext = {
  projectType: ProjectType;
  projectBackground?: string | null;
};

const TYPE_DEFINITIONS = `
Intent types:
- "Goal": A target the team wants to achieve. Example: "传达技术专业感"
- "Constraint": A hard requirement. Example: "必须有 SSO 单点登录"
- "Preference": A soft preference. Example: "颜色偏深色"
- "Reference": Pointer to an external benchmark. Example: "做得像 Linear 那样"
- "Veto": Explicit no. Example: "不要轮播图"
`.trim();

const SCOPE_RULES = `
Scope rules:
- "global": affects the entire product (positioning, audience, tone)
- A specific section name: hero / features / pricing / cta / faq / footer / etc.
- Nested with dot: pricing.team / hero.subtitle / features.first
- Pick the MOST SPECIFIC scope the statement implies.
`.trim();

const WEIGHT_RULES = `
Weight rules:
- "must": user explicitly required, or commercially non-negotiable
- "should": strong recommendation, room for negotiation
- "nice_to_have": bonus
Default to "should" when unclear.
`.trim();

const OUTPUT_SCHEMA = `
Output JSON only, matching exactly:
{
  "type": "Goal" | "Constraint" | "Preference" | "Reference" | "Veto",
  "scope": string,
  "weight": "must" | "should" | "nice_to_have",
  "rationale": string | null
}

NO markdown fences. NO commentary. NO trailing prose. JUST the JSON object.
`.trim();

export function buildExtractIntentSystem(ctx: ExtractContext): string {
  const projectTypeMap: Record<ProjectType, string> = {
    html: '落地页 (HTML landing page)',
    ppt: 'PPT 演示稿',
    doc: '文档',
    design: '设计稿',
  };
  return [
    'You are the Intent Extraction module of Darwin, a multi-human + multi-agent collaboration platform.',
    '',
    'Your job: given a single statement from a team member, extract a structured Intent for the team\'s collective intent layer.',
    '',
    `Project type: ${projectTypeMap[ctx.projectType]}`,
    ctx.projectBackground
      ? `Project background: ${ctx.projectBackground}`
      : '',
    '',
    TYPE_DEFINITIONS,
    '',
    SCOPE_RULES,
    '',
    WEIGHT_RULES,
    '',
    'Attached references: 如果 statement 里含 "【参考文件: name】<content>" / "【参考链接】<content>" / "【导入参考】<content>" / "【参考图片: name】" 区块, 那是用户挂的参考材料 — 你的输出应基于用户说的"原话"部分推断 type/scope/weight, 参考材料用来辅助理解上下文 (尤其抽 scope 和 rationale)。不要把参考材料原文塞进 rationale。当用户挂了【参考链接】或【参考文件】并明确说"参考"/"模仿"/"按这个风格"时, 通常 type=Reference / scope=global / weight=should。',
    '',
    OUTPUT_SCHEMA,
    '',
    'Examples:',
    '',
    'Statement: "要传达技术专业感,目标用户是 CTO"',
    '→ {"type":"Goal","scope":"global","weight":"must","rationale":"目标受众与基调,影响全局"}',
    '',
    'Statement: "视觉一定要有冲击力,要让人记住"',
    '→ {"type":"Goal","scope":"hero","weight":"must","rationale":"视觉冲击力主要在 hero 区域承担"}',
    '',
    'Statement: "Team 档要突出 SSO 等企业能力"',
    '→ {"type":"Constraint","scope":"pricing.team","weight":"should","rationale":"明确指向 pricing 的 Team 档,语气偏建议"}',
    '',
    'Statement: "不要用渐变背景"',
    '→ {"type":"Veto","scope":"global","weight":"must","rationale":"明确否决"}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildExtractIntentUser(statement: string): string {
  return `Statement: "${statement.replace(/"/g, '\\"')}"\n\nExtract the Intent.`;
}

/** Optional client-side validation (server should also validate via zod) */
export function isValidExtractedIntent(x: unknown): x is ExtractedIntent {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const validTypes = ['Goal', 'Constraint', 'Preference', 'Reference', 'Veto'];
  const validWeights = ['must', 'should', 'nice_to_have'];
  return (
    typeof o.type === 'string' &&
    validTypes.includes(o.type) &&
    typeof o.scope === 'string' &&
    o.scope.length > 0 &&
    typeof o.weight === 'string' &&
    validWeights.includes(o.weight) &&
    (o.rationale === null || typeof o.rationale === 'string')
  );
}
