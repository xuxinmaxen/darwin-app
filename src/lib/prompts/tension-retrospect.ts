/**
 * Prompt: 给一个刚解决的冲突写复盘卡。
 *
 * 重点不是 chronology, 是"谁让步、为什么让步、对未来意味着什么"。
 * 输出小巧 — lesson 要能一句话背下来, 进 team memory 时间线后是浏览级密度。
 */

import type { Intent, Tension, TensionOption } from '../types';
import type { Employee } from '../employees';

export type ThreadMessageLite = {
  authorName: string;
  authorKind: 'human' | 'agent';
  body: string;
  isDecision: boolean;
  createdAt: string;
};

export type TensionRetrospectInput = {
  tension: Pick<Tension, 'scope' | 'variant' | 'options' | 'createdAt' | 'resolvedAt' | 'resolution'>;
  sideIntents: Array<{
    intent: Pick<Intent, 'id' | 'statement' | 'type' | 'scope' | 'weight'>;
    author: Pick<Employee, 'id' | 'name' | 'role' | 'kind'>;
  }>;
  threadMessages: ThreadMessageLite[];
  projectName: string;
};

export type TensionRetrospectOutput = {
  winnerSide: string;     // intentId of winning side, or 'compromise' if both yielded
  yieldedBy: string[];    // employee NAMES (not ids) who yielded — empty for 'compromise'
  summary: string;        // 1-2 sentences, 3rd person, names in markdown bold
  lesson: string;         // ≤ 30 chars, memorable team-wide takeaway
  durationMinutes: number; // INTEGER minutes from tension.createdAt → resolvedAt
  messageCount: number;    // number of thread messages (already known to backend, LLM echoes for sanity)
};

export function buildTensionRetrospectSystem(input: TensionRetrospectInput): string {
  const sideLines = input.sideIntents.map((s, i) => {
    const kindLabel = s.author.kind === 'agent' ? 'Agent' : 'Human';
    return `Side ${String.fromCharCode(65 + i)}: ${s.author.name} (${kindLabel}, ${s.author.role}) — intentId=${s.intent.id} — [${s.intent.type} · ${s.intent.weight}] ${s.intent.statement.slice(0, 220)}`;
  }).join('\n');

  return [
    `You are the Team Memory Keeper of Darwin — a multi-human + multi-agent collaboration platform. A tension just resolved. Write a retrospect card that captures **who yielded, why, and what the team should remember for next time** — NOT a chronological play-by-play.`,
    '',
    `Project: ${input.projectName}`,
    `Tension scope: ${input.tension.scope} · variant: ${input.tension.variant}`,
    '',
    'Opposing sides:',
    sideLines,
    '',
    `Final selection: ${input.tension.resolution?.selectedOptionKey ?? '?'}`,
    input.tension.options.length > 0
      ? `Options were: ${input.tension.options.map(o => `${o.key}(${o.title.slice(0, 60)})`).join(' | ')}`
      : '',
    '',
    'Output rules:',
    '- winnerSide: the intentId of the side whose direction won. If both sides clearly compromised toward a middle option, output "compromise".',
    '- yieldedBy: array of employee NAMES (matching the names you see above, NOT ids) of people who moved off their starting position. Empty array if "compromise".',
    '- summary: 1-2 短句中文, 第三人称, **用 markdown bold 标记参与人名字**. 抓"谁起初坚持什么 → 谁的论据让谁动了 → 最终落点". 不要流水"先发了 X, 再发了 Y".',
    '- lesson: ≤ 30 个汉字一句话, 能被团队当作记忆点带到下个项目 (示例: "团队偏好软引导而非硬登录", "must 标签慎用, 容易绑死手脚").',
    '- 严格 JSON, 无 markdown fences, 无 prose 在 JSON 外。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildTensionRetrospectUser(input: TensionRetrospectInput): string {
  const lines: string[] = [];
  if (input.threadMessages.length > 0) {
    lines.push(`Discussion thread (${input.threadMessages.length} messages, chronological):`);
    for (const m of input.threadMessages.slice(0, 25)) {
      const decisionTag = m.isDecision ? ' [DECISION]' : '';
      lines.push(`  ${m.authorName} (${m.authorKind})${decisionTag}: ${m.body.slice(0, 240)}`);
    }
  } else {
    lines.push('No discussion thread was created (resolved without explicit messages).');
  }
  lines.push('');
  // Timestamps for duration calc — LLM doesn't need to do math but we provide it as ground truth
  const start = new Date(input.tension.createdAt).getTime();
  const end = input.tension.resolvedAt ? new Date(input.tension.resolvedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  lines.push(`Reference — durationMinutes=${minutes} · messageCount=${input.threadMessages.length}. Use these values in your output (do not recompute).`);
  lines.push('');
  lines.push('Output the JSON only.');
  return lines.join('\n');
}

export function isValidTensionRetrospectOutput(x: unknown): x is TensionRetrospectOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.winnerSide !== 'string' || o.winnerSide.length === 0) return false;
  if (!Array.isArray(o.yieldedBy)) return false;
  for (const n of o.yieldedBy) if (typeof n !== 'string') return false;
  if (typeof o.summary !== 'string' || o.summary.trim().length === 0) return false;
  if (typeof o.lesson !== 'string' || o.lesson.trim().length === 0) return false;
  if (typeof o.durationMinutes !== 'number' || !Number.isFinite(o.durationMinutes) || o.durationMinutes < 0) return false;
  if (typeof o.messageCount !== 'number' || !Number.isFinite(o.messageCount) || o.messageCount < 0) return false;
  return true;
}
