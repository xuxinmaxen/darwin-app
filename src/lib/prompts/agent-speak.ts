/**
 * Prompt: 让一个 Agent 员工按其 persona 主动贡献一条 Intent。
 *
 * 输出格式跟 Intent 抽取一致 (type/scope/weight/rationale + statement),
 * 这样可以直接走 createIntent 写库,前端展示统一。
 */

import type { Intent, ProjectType, EmployeeLearning } from '../types';
import type { Employee } from '../employees';

export type AgentSpeakInput = {
  agent: Employee;
  project: {
    name: string;
    type: ProjectType;
    background: string | null;
  };
  collaborators: Employee[];
  existingIntents: Intent[];
  /** Agent 的跨项目学习沉淀, 最多 5 条; 不传 / 空 → 不注入 */
  learnings?: EmployeeLearning[];
};

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页 (HTML landing page)',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function buildAgentSpeakSystem(input: AgentSpeakInput): string {
  const { agent, project, collaborators, learnings } = input;
  const teamLine = collaborators
    .map(e => `${e.name}${e.kind === 'agent' ? '（Agent）' : ''} · ${e.role}`)
    .join(', ');

  // 跨项目学习注入: speak 是 agent 主动开第一刀, 历史立场尤其重要
  const learningsBlock = learnings && learnings.length > 0
    ? [
        '',
        'Your recent reflections from prior projects (your opening Intent should be consistent with these — do NOT contradict yourself):',
        ...learnings.slice(0, 5).map((l, i) =>
          `  ${i + 1}. ${l.summary}${l.highlights.length > 0 ? ` — 重点: ${l.highlights.join(' · ')}` : ''}`
        ),
      ].join('\n')
    : '';

  return [
    `You ARE ${agent.name}, an Agent collaborator on a Darwin project. You contribute Intents from YOUR voice, not as a neutral assistant.`,
    '',
    `Your role: ${agent.role}.`,
    `Your persona (this is who you are — adopt the perspective, style, and concerns described here):`,
    `"${agent.persona ?? '（未填写人设,按一般产品/设计/工程同行的角度发言）'}"`,
    learningsBlock,
    '',
    `Project name: ${project.name}`,
    `Project type: ${TYPE_LABEL[project.type]}`,
    project.background ? `Project background: ${project.background}` : '',
    `Team: ${teamLine}`,
    '',
    'Darwin Intent model:',
    '- type: Goal | Constraint | Preference | Reference | Veto',
    '- scope: "global" or a section keyword (hero / features / pricing / cta / faq / footer) or nested (pricing.team / hero.cta / etc.)',
    '- weight: must | should | nice_to_have',
    '',
    'Your task: read the existing Intents (if any) and contribute ONE NEW Intent that:',
    '  1. Matches your persona — voice, vocabulary, concerns',
    '  2. Adds genuine value (not a paraphrase of what someone already said)',
    '  3. Is concrete enough to be acted on, not platitude',
    '  4. Stays in scope of the project',
    '',
    'Output STRICT JSON, no markdown fences, no prose:',
    '{',
    '  "statement": "<one short sentence in 中文, written as YOU would say it>",',
    '  "type": "Goal" | "Constraint" | "Preference" | "Reference" | "Veto",',
    '  "scope": "<scope keyword>",',
    '  "weight": "must" | "should" | "nice_to_have",',
    '  "rationale": "<one short sentence explaining why this Intent matters from your perspective>"',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildAgentSpeakUser(input: AgentSpeakInput): string {
  const { existingIntents, agent } = input;
  if (existingIntents.length === 0) {
    return [
      'No Intents have been added to the project yet. You are the first to speak.',
      `Open with one Intent that reflects ${agent.name}'s perspective on what THIS project most needs to nail.`,
    ].join('\n');
  }
  const lines: string[] = [];
  lines.push(`Existing Intents (${existingIntents.length} total, oldest first):`);
  lines.push('');
  for (let i = 0; i < existingIntents.length; i++) {
    const it = existingIntents[i];
    const author = it.authorKind === 'agent' ? 'Agent' : 'Human';
    lines.push(
      `${i + 1}. [${it.type} · scope:${it.scope} · ${it.weight} · ${author}] ${it.statement}`
    );
  }
  lines.push('');
  lines.push(
    `Now contribute ONE new Intent in ${agent.name}'s voice. Output the JSON only.`
  );
  return lines.join('\n');
}

export type AgentSpeakOutput = {
  statement: string;
  type: 'Goal' | 'Constraint' | 'Preference' | 'Reference' | 'Veto';
  scope: string;
  weight: 'must' | 'should' | 'nice_to_have';
  rationale: string | null;
};

export function isValidAgentSpeakOutput(x: unknown): x is AgentSpeakOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const validTypes = ['Goal', 'Constraint', 'Preference', 'Reference', 'Veto'];
  const validWeights = ['must', 'should', 'nice_to_have'];
  return (
    typeof o.statement === 'string' &&
    o.statement.trim().length > 0 &&
    typeof o.type === 'string' &&
    validTypes.includes(o.type) &&
    typeof o.scope === 'string' &&
    o.scope.length > 0 &&
    typeof o.weight === 'string' &&
    validWeights.includes(o.weight) &&
    (o.rationale === null ||
      o.rationale === undefined ||
      typeof o.rationale === 'string')
  );
}
