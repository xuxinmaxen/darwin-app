/**
 * Prompt: Agent 发布后从一个具体项目里沉淀学习。
 *
 * 跟 agent-tags 不一样:
 *   - agent-tags 看整个职业生涯抽 3 个抽象 stance, 服务于员工卡片
 *   - agent-learn 只看一个项目, 输出"这次学到什么", 服务于团队记忆时间线 + 回溯
 *
 * 重点是"对这个 agent 的人设 / 角色"有用, 而不是项目本身做了什么。
 * 项目本身做了什么是产物的事;agent 视角的学习是"我的角色下次该怎么做"的事。
 */

import type { Intent, Tension } from '../types';

export type AgentLearnInput = {
  agentName: string;
  agentRole: string;
  agentPersona?: string | null;
  projectName: string;
  projectBackground?: string | null;
  /** 该 agent 在这个项目里提的 intents (author_id 已过滤) */
  selfIntents: Pick<Intent, 'statement' | 'scope' | 'type' | 'weight'>[];
  /** 该 agent 卷入的 tensions (intentIds 含其某条 intent) — 只取 resolved 的, 因为决策结果才是学习材料 */
  involvedTensions: Pick<Tension, 'scope' | 'variant' | 'resolution'>[];
  /** 项目最终 intent 总数 (上下文) */
  totalIntents: number;
  /** 项目里出现过的 scopes (做产物结构摘要) */
  scopesInProject: string[];
};

export type AgentLearnOutput = {
  /** 1-2 句中文, 第三人称, 起句 "**Name** 学到 ..." 风格 */
  summary: string;
  /** 2-5 条短语 chip, 每条 ≤ 20 字, 抓**对该 agent 角色最有启发**的事 */
  highlights: string[];
};

export function buildAgentLearnSystem(input: AgentLearnInput): string {
  return [
    'You are the Agent Reflection module of Darwin — a multi-human + multi-agent collaboration platform.',
    '',
    `An agent named ${input.agentName} (role: ${input.agentRole}) just finished participating in a published project. Distill what THIS PROJECT taught the agent — specifically about its persona / role — into a tight learning record that will live in the team memory timeline.`,
    '',
    input.agentPersona ? `Agent persona: ${input.agentPersona}` : '',
    '',
    'Output JSON shape:',
    '{ "summary": "1-2 句中文 ...", "highlights": ["≤20 字短语", "..."] }',
    '',
    'Hard rules:',
    `- summary MUST be in 中文, 第三人称, 1-2 句, 起句风格: "**${input.agentName}** 学到..." 或 "**${input.agentName}** 体会到..." (Markdown bold OK around the name). 不要"我"或者第一人称.`,
    '- summary 必须挂钩**这个项目里的具体决策 / 冲突 / 用户偏好** — 不要写"加强了对设计的理解"这种空话.',
    '- highlights 2-5 条, 每条 ≤ 20 个汉字, 抓**对该 agent 角色最有启发**的事. 各条不重复, 不互相包含.',
    '- 角度是"这位 agent 下次类似项目可以怎么做" — 不是"项目做了 X" 而是 "agent 学到 X".',
    '- 如果该 agent 在项目里没提 intent / 没卷入冲突 → highlights 给 0-1 条最克制的观察, summary 写 "**${input.agentName}** 这次主要旁观, 学到 [...]".',
    '- 输出 STRICT JSON, NO markdown fences, NO prose 在 JSON 之外.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildAgentLearnUser(input: AgentLearnInput): string {
  const lines: string[] = [];
  lines.push(`Project: ${input.projectName}`);
  if (input.projectBackground) lines.push(`Background: ${input.projectBackground}`);
  lines.push('');
  lines.push(`This agent (${input.agentName} · ${input.agentRole}) contributed ${input.selfIntents.length} intents to the project (project total: ${input.totalIntents}).`);

  if (input.selfIntents.length > 0) {
    lines.push('');
    lines.push("Agent's own intents (newest first):");
    for (const it of input.selfIntents.slice(-15).reverse()) {
      lines.push(`- [${it.type} · ${it.scope} · ${it.weight}] ${it.statement.slice(0, 240)}`);
    }
  }

  if (input.involvedTensions.length > 0) {
    lines.push('');
    lines.push(`Tensions the agent was involved in (${input.involvedTensions.length}, resolved only):`);
    for (const t of input.involvedTensions.slice(-10)) {
      let chosen = '?';
      if (t.resolution && typeof t.resolution === 'object') {
        const r = t.resolution as { selectedOptionKey?: string };
        if (r.selectedOptionKey) chosen = r.selectedOptionKey;
      }
      lines.push(`- [${t.scope} · ${t.variant}] → 团队选定 ${chosen}`);
    }
  }

  if (input.scopesInProject.length > 0) {
    lines.push('');
    lines.push(`Project scopes touched: ${Array.from(new Set(input.scopesInProject)).slice(0, 12).join(', ')}`);
  }

  lines.push('');
  lines.push('Output the JSON only.');
  return lines.join('\n');
}

export function isValidAgentLearnOutput(x: unknown): x is AgentLearnOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.summary !== 'string' || o.summary.trim().length === 0) return false;
  if (!Array.isArray(o.highlights)) return false;
  for (const h of o.highlights) {
    if (typeof h !== 'string') return false;
  }
  return true;
}
