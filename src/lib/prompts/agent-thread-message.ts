/**
 * Prompt: Agent 在讨论 thread 里发言。
 *
 * 区别于 agent-speak (写一条新 Intent) 和 agent-react (基于触发 Intent 写新 Intent),
 * 本 prompt 让 Agent 在已有的 thread 上下文里说一句"作为参与方的发言":
 *   - 站在自己 persona / 自己写过的 Intent 立场
 *   - 不再凭空开新主张, 是在讨论里和团队同步视角
 *   - 默认沉默: 没什么有信息量的就 say=false
 */

import type { Tension, Intent, ThreadMessage, ProjectType } from '../types';
import type { Employee } from '../employees';

export type AgentThreadInput = {
  agent: Employee;
  project: { name: string; type: ProjectType; background: string | null };
  scope: string;
  /** Tension 关联时给, 否则给 null */
  tension?: {
    partyA: { name: string; intent: Intent };
    partyB: { name: string; intent: Intent };
    options: { key: string; title: string; desc: string }[];
  } | null;
  recentMessages: Pick<ThreadMessage, 'authorKind' | 'body' | 'isDecision'>[];
};

export type AgentThreadOutput =
  | { say: false; reason: string }
  | { say: true; statement: string };

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

export function buildAgentThreadSystem(input: AgentThreadInput): string {
  const lines: string[] = [
    `You are ${input.agent.name}, an Agent collaborator on a Darwin team.`,
    input.agent.persona ? `Your persona: ${input.agent.persona}` : '',
    `You sit in role: ${input.agent.role}.`,
    '',
    'Darwin first principle: Intent 是协作单位, AI 是调和者, 人是最终决策者。',
    `Project: ${input.project.name} (${TYPE_LABEL[input.project.type]})`,
    input.project.background ? `Project background: ${input.project.background}` : '',
    `Discussion scope: ${input.scope}`,
    '',
    'Your job: drop one short message into this discussion thread, in YOUR voice.',
    'Rules (strict):',
    '- 1-2 sentences in 中文. ≤ 80 字.',
    '- Speak as a teammate, not a system. 用 "我" / "我倾向" / "我担心" 的口吻.',
    '- 如果 tension 给了, 你应该亮明你的立场 (基于你的 persona / 你之前的 Intent), 而不是绕弯.',
    '- DEFAULT silence: if you have nothing concrete to add, return say=false. False positives waste team attention.',
    '- 不要复读他人观点; 不要写"我同意"这种空话; 不要长篇大论.',
    '- 可以同意某个 option (A/B/C), 也可以提一个具体的妥协建议. 不要拒绝参与.',
    '',
    'Output STRICT JSON, no markdown fences:',
    '{ "say": false, "reason": "..." }',
    '或',
    '{ "say": true, "statement": "..." }',
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildAgentThreadUser(input: AgentThreadInput): string {
  const lines: string[] = [];
  if (input.tension) {
    lines.push('Tension on this scope:');
    lines.push(`  Party A — ${input.tension.partyA.name}: ${input.tension.partyA.intent.statement}`);
    lines.push(`  Party B — ${input.tension.partyB.name}: ${input.tension.partyB.intent.statement}`);
    lines.push('');
    lines.push('AI 已生成 3 个调和方案:');
    for (const opt of input.tension.options) {
      lines.push(`  ${opt.key}. ${opt.title} — ${opt.desc}`);
    }
    lines.push('');
  }
  if (input.recentMessages.length > 0) {
    lines.push('Recent messages in the thread:');
    for (const m of input.recentMessages.slice(-12)) {
      const kindTag = m.isDecision ? '[决议] ' : '';
      lines.push(`  - ${kindTag}(${m.authorKind}) ${m.body}`);
    }
    lines.push('');
  }
  lines.push('Decide: speak or stay silent. Output the JSON only.');
  return lines.join('\n');
}

export function isValidAgentThreadOutput(x: unknown): x is AgentThreadOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.say === false) return true;
  if (o.say !== true) return false;
  if (typeof o.statement !== 'string' || !o.statement.trim()) return false;
  return true;
}
