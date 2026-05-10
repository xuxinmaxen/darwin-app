/**
 * Prompt: 一次 tension 解决后, 从决议 + 讨论里提取一条
 * "团队共识候选项" — 让团队选要不要沉淀进 team_prefs。
 *
 * 关键约束:
 *   - 默认沉默: 没看到稳健的、可跨项目复用的判断 → 不产候选
 *   - 候选必须是"团队层面的取向", 不是"这个项目的具体决定"
 *     反例: "hero 用蓝色" → 项目细节, 不沉淀
 *     正例: "传达技术专业感优先于视觉冲击力" → 团队取向, 沉淀
 *   - 字数控制, 严格 JSON
 */

import type { Intent, ProjectType, TensionOption, ThreadMessage } from '../types';

export type ExtractPrefInput = {
  project: { name: string; type: ProjectType; background: string | null };
  scope: string;
  partyA: { name: string; intent: Intent };
  partyB: { name: string; intent: Intent };
  selectedOption: TensionOption;
  decisionSummary?: string | null;
  /** 讨论消息正文 (按顺序, system + human + agent), 仅取最近 8 条 */
  recentMessages: Pick<ThreadMessage, 'authorKind' | 'body' | 'isDecision'>[];
};

export type ExtractPrefOutput =
  | { worth: false; reason: string }
  | {
      worth: true;
      iconKey: 'pen' | 'eye' | 'graph' | 'audience' | 'flow' | 'note';
      category: string;          // ≤ 12 字
      body: string;              // ≤ 80 字, 支持 **加粗**
      confidence: number;        // 0-100
      sourceHint: string;        // e.g. "hero 冲突 · AI 仲裁"
    };

const TYPE_LABEL: Record<ProjectType, string> = {
  html: '落地页',
  ppt: 'PPT',
  doc: '文档',
  design: '设计稿',
};

const ICON_HINT = [
  'pen      = 文案 / 写作风格',
  'eye      = 视觉 / 色彩 / 排版',
  'graph    = 商业 / 增长 / 转化',
  'audience = 目标人群 / 受众',
  'flow     = 协作 / 流程',
  'note     = 其他不归类',
].join('\n');

export function buildExtractPrefSystem(input: ExtractPrefInput): string {
  return [
    'You are the Memory Distiller of Darwin — a multi-human + multi-agent collaboration platform.',
    'After a tension is resolved, your job is to decide whether the resolution carries a TEAM-LEVEL preference worth sedimenting into long-term team memory.',
    '',
    `Project: ${input.project.name} (${TYPE_LABEL[input.project.type]})`,
    input.project.background ? `Project background: ${input.project.background}` : '',
    `Scope: ${input.scope}`,
    '',
    'Decision rule — DEFAULT TO worth=false:',
    '- Output worth=true ONLY if the resolution expresses a stance the team would carry into future projects.',
    '- Project-specific picks ("用蓝色 hero", "三档定价") are NOT worth — they don\'t generalize.',
    '- Generalizable stances ARE worth ("传达技术专业感优先于视觉冲击力", "免费档优先无水印,转化靠功能扩展而非阻断").',
    '- If unsure, return worth=false. False negatives are cheap; false positives pollute team memory.',
    '',
    'When worth=true:',
    '- iconKey: pick one of pen / eye / graph / audience / flow / note.',
    `  ${ICON_HINT}`,
    '- category: ≤ 12 字, 例: "文案风格" / "视觉风格" / "目标受众" / "商业策略" / "协作风格".',
    '- body: ≤ 80 字, 1-2 句, 团队会照着说回来的口吻. 可用 **加粗** 强调关键词. 不要复述具体方案细节, 写"取向".',
    '- confidence: 0-100, < 60 应该改成 worth=false.',
    '- sourceHint: 极短一句, 例: "hero 冲突 · 团队仲裁" / "pricing 冲突 · AI 仲裁".',
    '',
    'Output STRICT JSON, no markdown fences, no prose:',
    '{ "worth": false, "reason": "..." }',
    '或',
    '{',
    '  "worth": true,',
    '  "iconKey": "...",',
    '  "category": "...",',
    '  "body": "...",',
    '  "confidence": 75,',
    '  "sourceHint": "..."',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildExtractPrefUser(input: ExtractPrefInput): string {
  const lines: string[] = [];
  lines.push(`Tension on scope "${input.scope}":`);
  lines.push('');
  lines.push(`Party A — ${input.partyA.name}: ${input.partyA.intent.statement}`);
  lines.push(`Party B — ${input.partyB.name}: ${input.partyB.intent.statement}`);
  lines.push('');
  lines.push(`Selected option (${input.selectedOption.key}): ${input.selectedOption.title}`);
  lines.push(`  ${input.selectedOption.desc}`);
  if (input.decisionSummary) {
    lines.push('');
    lines.push(`Decision summary: ${input.decisionSummary}`);
  }
  if (input.recentMessages.length > 0) {
    lines.push('');
    lines.push('Recent discussion:');
    for (const m of input.recentMessages.slice(-8)) {
      const tag = m.isDecision ? '[DECISION] ' : '';
      lines.push(`  - ${tag}(${m.authorKind}) ${m.body}`);
    }
  }
  lines.push('');
  lines.push('Decide: is this worth distilling? Output the JSON only.');
  return lines.join('\n');
}

export function isValidExtractOutput(x: unknown): x is ExtractPrefOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.worth === false) return true;
  if (o.worth !== true) return false;
  if (typeof o.iconKey !== 'string') return false;
  if (!['pen', 'eye', 'graph', 'audience', 'flow', 'note'].includes(o.iconKey as string)) return false;
  if (typeof o.category !== 'string' || !o.category.trim()) return false;
  if (typeof o.body !== 'string' || !o.body.trim()) return false;
  if (typeof o.confidence !== 'number') return false;
  if (typeof o.sourceHint !== 'string' || !o.sourceHint.trim()) return false;
  return true;
}
