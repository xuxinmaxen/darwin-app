/**
 * Prompt: 给定一个 DOM 元素的 outerHTML + 用户的修改注解, 让 LLM 输出改完后的整段 outerHTML。
 *
 * 用法严格限定 "做最小手术":
 *   - 输入是一个被 pin 的具体元素 (button/p/section 等, 一般 < 500 字符)
 *   - 输出是该元素改完后的 outerHTML, 仍然是这一个元素 (同标签, 同属性 schema, 不分裂不合并)
 *   - 不输出 prose, 不输出 markdown fence, 不写注释 "rest preserved"
 *
 * 这条 prompt 是新架构的核心 — 因为输入小, LLM 没有任何"省略输出"的理由,
 * 输出也短 (< 1000 字符), maxTokens 不会撞顶, latency 可控 (~ 2-5s)。
 */

export type PatchElementInput = {
  outerHtml: string;
  note: string;
  /** 元素在源 HTML 里的前 / 后邻居 (最多各 200 字), 给 LLM 判断"什么不能动" */
  contextBefore?: string;
  contextAfter?: string;
  /** 元素所在的最近 heading 文本, 让 LLM 不要被同名兄弟节点误导 */
  nearestHeading?: string;
};

export function buildPatchElementSystem(): string {
  return [
    'You patch a single DOM element. The user pinned ONE element and gave you a short note saying what should change.',
    '',
    'INPUT: the outerHTML of that ONE element, plus the user note.',
    'OUTPUT: the outerHTML of that SAME element, with the note applied. Nothing else.',
    '',
    'HARD RULES (non-negotiable):',
    '1. Output ONLY the patched outerHTML. No markdown fences. No prose before or after. No `// ...` comments.',
    '2. Keep the SAME outer tag (button → button, p → p). Do NOT replace with a different tag.',
    '3. Preserve ALL attributes (class, id, onclick, data-*, aria-*, style, etc.) unless the note explicitly says to change one.',
    '4. Preserve ALL child structure (sub-elements, SVG paths, nested spans) unless the note explicitly targets a child.',
    '5. Apply ONLY the minimal change the note describes. If the note says "rename X to Y", change only the literal text "X" → "Y" in textContent, nothing else.',
    '6. If the note is ambiguous (e.g. "make it better"), output the input unchanged.',
    '7. Do NOT add explanatory <script>, <style>, or comments inside the output element.',
    '',
    'You are NOT redesigning. You are NOT improving. You are NOT regenerating from scratch. You are doing a 1-word/1-attribute surgical edit.',
  ].join('\n');
}

export function buildPatchElementUser(input: PatchElementInput): string {
  const lines: string[] = [];
  lines.push('Element to patch (its outerHTML):');
  lines.push('```');
  lines.push(input.outerHtml);
  lines.push('```');
  lines.push('');
  lines.push(`User note: ${input.note}`);
  if (input.nearestHeading) {
    lines.push(`Context — this element lives under heading: "${input.nearestHeading}"`);
  }
  if (input.contextBefore || input.contextAfter) {
    lines.push('');
    lines.push('Surrounding context (do NOT modify, just for orientation):');
    if (input.contextBefore) lines.push(`  before: ...${input.contextBefore.slice(-160)}`);
    if (input.contextAfter)  lines.push(`  after:  ${input.contextAfter.slice(0, 160)}...`);
  }
  lines.push('');
  lines.push('Output the patched outerHTML now (raw HTML, no fences, no prose):');
  return lines.join('\n');
}

/**
 * 校验 LLM 输出像不像一个 outerHTML 片段。
 * 不做严格平衡检查 (那留给 cheerio 二次 parse), 这里只挡明显跑题的输出。
 */
export function looksLikePatchedHtml(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  if (!trimmed.startsWith('<')) return false;
  // 不允许 markdown fence
  if (trimmed.startsWith('```')) return false;
  // 不允许 prose 开头 (e.g. "Here is...")
  if (/^[A-Z][a-z]+ /.test(trimmed.slice(0, 20))) return false;
  // 不允许整段都是占位注释
  if (/^<!--[\s\S]*-->$/.test(trimmed)) return false;
  return true;
}
