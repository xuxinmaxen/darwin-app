/**
 * Prompt: 让一个 Agent 协作者「看到刚有人发了一条 Intent」后,自己判断要不要接话。
 *
 * 跟 agent-speak 不同: 这里 Agent 默认沉默,只在真有独到角度时说话。
 * Output 含 shouldSpeak 显式开关,服务端按此决定写不写库。
 */

import type { Intent, ProjectType, EmployeeLearning } from '../types';
import type { Employee } from '../employees';

export type AgentReactInput = {
  agent: Employee;
  project: {
    name: string;
    type: ProjectType;
    background: string | null;
  };
  collaborators: Employee[];
  existingIntents: Intent[];
  triggerIntent: Intent;
  /** Agent 的跨项目学习沉淀, 最多 5 条; 不传 / 空数组 → prompt 不注入该段, 行为退化为旧版 */
  learnings?: EmployeeLearning[];
};

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页 (HTML landing page)',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function buildAgentReactSystem(input: AgentReactInput): string {
  const { agent, project, collaborators, learnings } = input;
  const teamLine = collaborators
    .map(e => `${e.name}${e.kind === 'agent' ? '（Agent）' : ''} · ${e.role}`)
    .join(', ');

  // 跨项目学习注入: 让 agent 在 react 时记得自己历史立场, 避免跟自己矛盾
  const learningsBlock = learnings && learnings.length > 0
    ? [
        '',
        'Your recent reflections from prior projects (stay consistent with these stances, do NOT contradict yourself):',
        ...learnings.slice(0, 5).map((l, i) =>
          `  ${i + 1}. ${l.summary}${l.highlights.length > 0 ? ` — 重点: ${l.highlights.join(' · ')}` : ''}`
        ),
      ].join('\n')
    : '';

  return [
    `You ARE ${agent.name}, an Agent collaborator in a Darwin project. Someone just posted a new Intent. Decide whether you genuinely have something to add — or stay silent.`,
    '',
    `Your role: ${agent.role}.`,
    `Your persona:`,
    `"${agent.persona ?? '（未填人设,按一般同行视角）'}"`,
    learningsBlock,
    '',
    `Project name: ${project.name}`,
    `Project type: ${TYPE_LABEL[project.type]}`,
    project.background ? `Project background: ${project.background}` : '',
    `Team: ${teamLine}`,
    '',
    'DEFAULT TO SILENT. Only speak when ALL of these are true:',
    '  1. You have a meaningfully different angle from what already exists',
    '  2. The angle aligns with your persona — not generic "AI assistant" advice',
    '  3. The trigger Intent invites or implies a follow-up from your role',
    '  4. Your contribution is concrete, not platitude',
    '',
    'STAY SILENT when:',
    '  - The trigger Intent is already complete on its own',
    '  - Your would-be contribution paraphrases an existing Intent',
    '  - The project is outside your expertise',
    '  - You only have generic "good idea, also consider X" filler',
    '',
    'Darwin Intent model:',
    '- type: Goal | Constraint | Preference | Reference | Veto',
    '- scope: "global" or section keyword (hero / features / pricing / cta / faq / footer) or nested (pricing.team / hero.cta / etc.)',
    '- weight: must | should | nice_to_have',
    '',
    'Output STRICT JSON, no markdown, no prose:',
    '',
    'If staying silent:',
    '{ "shouldSpeak": false, "reason": "<one short sentence why you chose silence>" }',
    '',
    'If speaking:',
    '{',
    '  "shouldSpeak": true,',
    '  "statement": "<one short sentence in 中文, in YOUR voice>",',
    '  "type": "Goal" | "Constraint" | "Preference" | "Reference" | "Veto",',
    '  "scope": "<scope keyword>",',
    '  "weight": "must" | "should" | "nice_to_have",',
    '  "rationale": "<one short sentence on why this matters from your perspective>"',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildAgentReactUser(input: AgentReactInput): string {
  const { existingIntents, triggerIntent, agent } = input;
  const lines: string[] = [];
  if (existingIntents.length > 1) {
    // existingIntents 包含 trigger,显示其它的作为背景
    const others = existingIntents.filter(i => i.id !== triggerIntent.id);
    lines.push(`Background — Intents already in this project (${others.length}):`);
    for (let i = 0; i < others.length; i++) {
      const it = others[i];
      const author = it.authorKind === 'agent' ? 'Agent' : 'Human';
      lines.push(
        `  ${i + 1}. [${it.type} · ${it.scope} · ${it.weight} · ${author}] ${it.statement}`
      );
    }
    lines.push('');
  }
  lines.push('Trigger — the Intent that was just posted:');
  lines.push(
    `  [${triggerIntent.type} · ${triggerIntent.scope} · ${triggerIntent.weight} · ${triggerIntent.authorKind === 'agent' ? 'Agent' : 'Human'}] ${triggerIntent.statement}`
  );
  lines.push('');
  lines.push(
    `Decide: should ${agent.name} speak now? Output the JSON only.`
  );
  return lines.join('\n');
}

export type AgentReactOutput =
  | { shouldSpeak: false; reason?: string }
  | {
      shouldSpeak: true;
      statement: string;
      type: 'Goal' | 'Constraint' | 'Preference' | 'Reference' | 'Veto';
      scope: string;
      weight: 'must' | 'should' | 'nice_to_have';
      rationale: string | null;
    };

export function isValidAgentReactOutput(x: unknown): x is AgentReactOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.shouldSpeak === false) return true;
  if (o.shouldSpeak !== true) return false;
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
