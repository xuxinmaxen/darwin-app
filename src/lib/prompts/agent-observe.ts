/**
 * Prompt: Agent 在团队完成一次冲突解决后, 旁观整个项目状态, 决定要不要补一刀。
 *
 * 跟 agent-react 不同:
 *   - react 是"看到新 intent 决定要不要接话" — 反应式
 *   - observe 是"看到团队刚做完一个决定, 反思项目整体, 看自己人设角度有没有漏掉的关键点" — 反思式
 *
 * Default to silent — 跟 react 一样, 沉默是第一选项。只在真有非废话的洞见时说话。
 * statement 会被服务端加 '【观察】 ' 前缀, 跟普通 react intent 视觉区分。
 *
 * 跨项目学习 (EmployeeLearning[]) 注入到 system prompt, 让 agent "记得" 之前学到的东西,
 * 提观察时不会跟历史立场矛盾。
 */

import type { Intent, ProjectType, Tension, EmployeeLearning } from '../types';
import type { Employee } from '../employees';

export type AgentObserveInput = {
  agent: Employee;
  project: {
    name: string;
    type: ProjectType;
    background: string | null;
  };
  allIntents: Intent[];
  /** 刚解决的冲突 — 触发本次反思的事件 */
  resolvedTension: Pick<Tension, 'scope' | 'variant' | 'options' | 'resolution' | 'intentIds'>;
  /** 该 agent 跨项目的最近学习, 最多 5 条 */
  learnings: EmployeeLearning[];
  /** 项目里出现过的 scope 列表 (帮 LLM 判断空白区) */
  scopesInProject: string[];
};

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页 (HTML landing page)',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function buildAgentObserveSystem(input: AgentObserveInput): string {
  const { agent, project, learnings } = input;

  const learningsBlock = learnings.length > 0
    ? [
        '',
        'Your recent reflections from prior projects (use to stay consistent with your past stances, do NOT contradict yourself):',
        ...learnings.slice(0, 5).map((l, i) =>
          `  ${i + 1}. ${l.summary}${l.highlights.length > 0 ? ` — 重点: ${l.highlights.join(' · ')}` : ''}`
        ),
      ].join('\n')
    : '';

  return [
    `You ARE ${agent.name}, an Agent collaborator in a Darwin project. The team just resolved a tension. Now you stand back and look at the WHOLE project — is there anything important the team is missing that your role should flag?`,
    '',
    `Your role: ${agent.role}.`,
    `Your persona: "${agent.persona ?? '（未填人设,按一般同行视角）'}"`,
    learningsBlock,
    '',
    `Project name: ${project.name}`,
    `Project type: ${TYPE_LABEL[project.type]}`,
    project.background ? `Project background: ${project.background}` : '',
    '',
    'DEFAULT TO SILENT. A noisy observer is worse than a silent one. Only speak when ONE of these is *clearly* true:',
    '  - A critical scope is empty (e.g. no Constraint about 移动端 / 性能 / 无障碍 for a landing page where your role would care)',
    '  - The just-resolved decision conflicts with one of your prior project learnings — and you should flag the inconsistency',
    '  - A "must" intent that you would expect from your role is missing entirely',
    '  - The intent distribution is dangerously lopsided (e.g. 6 Goals 0 Constraints — risk surface unaddressed)',
    '',
    'STAY SILENT when:',
    '  - The project just resolved a tension cleanly — give the team a moment',
    '  - Your observation would just paraphrase an existing intent',
    '  - You only have generic "consider also X" filler with no specific anchor',
    '  - The project is outside your expertise',
    '',
    'Darwin Intent model:',
    '- type: Goal | Constraint | Preference | Reference | Veto',
    '- scope: "global" or section keyword (hero / features / pricing / cta / faq / footer)',
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
    `  "statement": "<one short sentence in 中文, starting with '**${agent.name}** 注意到' or '**${agent.name}** 看完整个项目后, 想补一条' — in YOUR voice>",`,
    '  "type": "Goal" | "Constraint" | "Preference" | "Reference" | "Veto",',
    '  "scope": "<scope keyword or \'global\'>",',
    '  "weight": "must" | "should" | "nice_to_have",',
    '  "rationale": "<one short sentence on why this matters from your perspective + any link to prior learning>"',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildAgentObserveUser(input: AgentObserveInput): string {
  const { allIntents, resolvedTension, agent, scopesInProject } = input;
  const lines: string[] = [];

  lines.push(`Trigger — the team just resolved this tension:`);
  let selectedKey = '?';
  if (resolvedTension.resolution?.selectedOptionKey) selectedKey = resolvedTension.resolution.selectedOptionKey;
  lines.push(`  [scope: ${resolvedTension.scope} · variant: ${resolvedTension.variant}] → selected ${selectedKey}`);
  if (resolvedTension.options.length > 0) {
    lines.push(`  Options were:`);
    for (const opt of resolvedTension.options.slice(0, 4)) {
      lines.push(`    - ${opt.key}: ${opt.title} — ${opt.desc}`);
    }
  }
  lines.push('');

  if (allIntents.length > 0) {
    lines.push(`Whole project state — ${allIntents.length} intents:`);
    for (const it of allIntents.slice(-25)) {
      const author = it.authorKind === 'agent' ? 'Agent' : 'Human';
      lines.push(`  [${it.type} · ${it.scope} · ${it.weight} · ${author}] ${it.statement.slice(0, 180)}`);
    }
    lines.push('');
  }

  if (scopesInProject.length > 0) {
    lines.push(`Scopes touched in this project: ${scopesInProject.join(', ')}`);
    lines.push('');
  }

  lines.push(`Decide: should ${agent.name} speak now with a project-wide observation? Output the JSON only.`);
  return lines.join('\n');
}

export type AgentObserveOutput =
  | { shouldSpeak: false; reason?: string }
  | {
      shouldSpeak: true;
      statement: string;
      type: 'Goal' | 'Constraint' | 'Preference' | 'Reference' | 'Veto';
      scope: string;
      weight: 'must' | 'should' | 'nice_to_have';
      rationale: string | null;
    };

export function isValidAgentObserveOutput(x: unknown): x is AgentObserveOutput {
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
    (o.rationale === null || o.rationale === undefined || typeof o.rationale === 'string')
  );
}
