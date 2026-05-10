/**
 * Prompt: 给定一个 Agent 写过的若干条 Intent (statement + scope + type),
 * 抽出 ≤3 个反映其"取向 / 视角"的短 tag。
 *
 * 这是 Agent 学习画像的核心: 团队看 /memory 时, Agent 卡片上挂这些 tag,
 * 一眼看出"这位 Agent 在团队里站在哪个角度"。
 *
 * 不要做的事:
 *   - 不要回 "AI", "Agent", "智能" 这种空话
 *   - 不要回职业角色 (PM/UI/RD), 那是它的 role, 不是学习画像
 *   - intent 太少 (<2) → 直接返空数组
 */

import type { Intent } from '../types';

export type AgentTagsInput = {
  agentName: string;
  agentRole: string;
  agentPersona?: string | null;
  intents: Pick<Intent, 'statement' | 'scope' | 'type' | 'weight'>[];
};

export type AgentTagsOutput = {
  tags: string[]; // ≤3, each ≤6 字
};

export function buildAgentTagsSystem(input: AgentTagsInput): string {
  return [
    'You are the Agent Profiler of Darwin — a multi-human + multi-agent collaboration platform.',
    '',
    'Given the Intents an agent has contributed, output ≤3 short Chinese tags that capture its STANCE / PERSPECTIVE — what it consistently emphasizes across projects.',
    '',
    `Agent: ${input.agentName} (role: ${input.agentRole})`,
    input.agentPersona ? `Persona: ${input.agentPersona}` : '',
    '',
    'Tag rules (strict):',
    '- Each tag ≤ 6 个汉字 (or short English/digits).',
    '- Output 0-3 tags. If fewer than 2 intents, output 0 tags (return [] ).',
    '- NEVER output role labels (PM / UI / RD), generic AI labels (AI/智能/助手), or single-project specifics ("hero 用蓝色").',
    '- Tags should be ABSTRACT stances that would survive across projects:',
    '  好: "视觉敏感", "数据驱动", "克制美学", "转化优先", "无障碍敏感"',
    '  坏: "PM", "AI", "做了一份 hero", "喜欢蓝色"',
    '- Prefer Chinese over English when the agent\'s intents are in Chinese.',
    '- Dedup: don\'t output near-synonyms (e.g. 不要同时给"克制" + "克制美学").',
    '',
    'Output STRICT JSON, no markdown fences, no prose:',
    '{ "tags": ["...", "..."] }',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildAgentTagsUser(input: AgentTagsInput): string {
  if (input.intents.length === 0) {
    return 'Agent has not written any Intents yet. Output: { "tags": [] }';
  }
  const lines: string[] = [];
  lines.push(`Agent contributed ${input.intents.length} Intents:`);
  lines.push('');
  for (const it of input.intents.slice(-30)) {
    lines.push(`- [${it.type} · ${it.scope} · ${it.weight}] ${it.statement}`);
  }
  lines.push('');
  lines.push('Output the JSON only.');
  return lines.join('\n');
}

export function isValidAgentTagsOutput(x: unknown): x is AgentTagsOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.tags)) return false;
  for (const t of o.tags) {
    if (typeof t !== 'string') return false;
  }
  return true;
}
