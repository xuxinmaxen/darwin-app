/**
 * 服务端标注修改 (annotated patch) 主流程。
 *
 * 设计核心: 不让 LLM 输出整个 200KB HTML, 改为 cheerio 在服务端拼接 — LLM 只负责
 * 给单个被 pin 元素的小改动。结构上消除"输出 stub 占位"风险, latency 也线性可控。
 *
 * 流程:
 *   1. 解析 newIntents 里所有 【标注修改】 块 → 一组 { selector, text?, parentPath?, nearestHeading?, note } 平铺
 *   2. cheerio load existingHtml
 *   3. 对每条 patch 并行:
 *      a. 多策略找元素: $(selector) → filter by text → filter by nearestHeading ancestor
 *      b. 没命中 → 标记 skipped, 不阻断其它
 *      c. 命中 → 拿 outerHTML + 邻居上下文 → 调 patchElement (LLM)
 *      d. 拿到改后 outerHTML → cheerio replaceWith
 *   4. 输出 cheerio $.html()
 *
 * 注: cheerio 的 load(html, { decodeEntities: false, xmlMode: false }) 保留原文档
 * DOCTYPE 和实体, 不会重新 normalize 整页, 这是结构保真的关键。
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
// cheerio 的 $(selector) 返回 Cheerio<AnyNode> (含 Document/Text/CDATA/Element);
// 我们只关心 Element 节点 — Element 是 AnyNode 的子类型, 用 AnyNode 通用一些, 后续 .get(0) 拿到再 cast。
import type { AnyNode, Element } from 'domhandler';
import type { Intent } from './types';
import { patchElement } from './patch-element';

const ANNOT_BLOCK_RE = /【标注修改】[\s\S]*?(?=\n\n【(?:参考文件|导入参考|参考链接|参考图片)|$)/;
const ANNOT_LINE_RE = /^\s*(\d+)\.\s*\[([^\]]+)\]\s*(.+)$/;

export type AnnotatedPatch = {
  intentId: string;
  pinIndex: number;          // 块内第几条 (1-based)
  selector: string;          // 主匹配选择器 (darwin-mark 给的 tag.class / #id / [data-...])
  text?: string;             // 被 pin 元素 textContent 的 80 字截断
  parentPath?: string;       // ancestor chain, 跨多 tab/section 时用来 disambiguate
  nearestHeading?: string;   // 最近 heading 文本, 用来 disambiguate 同名按钮
  note: string;              // 用户写的修改注解
};

/**
 * 从一条 intent.statement 里抽出所有 patch tuples。
 * Statement 里既可能含用户的 free text, 也含 【标注修改】 块 — 我们只取块内每行。
 */
export function parseAnnotatedPatches(statement: string, intentId: string): AnnotatedPatch[] {
  const blockMatch = statement.match(ANNOT_BLOCK_RE);
  if (!blockMatch) return [];
  const block = blockMatch[0];
  // 去掉首行 "【标注修改】", 剩下的逐行尝试匹配
  const lines = block.split('\n').slice(1);
  const patches: AnnotatedPatch[] = [];
  for (const line of lines) {
    const m = ANNOT_LINE_RE.exec(line);
    if (!m) continue;
    const pinIndex = parseInt(m[1], 10);
    const meta = m[2];
    const note = m[3].trim();
    // meta 内部用 ` · ` 分隔多段。第一段是 selector, 接下来可能有:
    //   "..."  → text (双引号包裹)
    //   at: ...  → parentPath
    //   in: "..."  → nearestHeading
    const segs = meta.split(' · ').map(s => s.trim());
    const selector = segs[0] ?? '';
    let text: string | undefined;
    let parentPath: string | undefined;
    let nearestHeading: string | undefined;
    for (const seg of segs.slice(1)) {
      if (seg.startsWith('"') && seg.endsWith('"')) {
        text = seg.slice(1, -1);
      } else if (seg.startsWith('at:')) {
        parentPath = seg.slice(3).trim();
      } else if (seg.startsWith('in:')) {
        const inner = seg.slice(3).trim();
        nearestHeading = inner.startsWith('"') && inner.endsWith('"')
          ? inner.slice(1, -1)
          : inner;
      }
    }
    patches.push({
      intentId, pinIndex, selector, text, parentPath, nearestHeading, note,
    });
  }
  return patches;
}

/** 把多条 intent 里所有 patch 平铺 */
export function collectPatchesFromIntents(intents: Intent[]): AnnotatedPatch[] {
  const all: AnnotatedPatch[] = [];
  for (const it of intents) {
    all.push(...parseAnnotatedPatches(it.statement, it.id));
  }
  return all;
}

export function hasAnnotatedPatches(intents: Intent[]): boolean {
  return intents.some(i => /【标注修改】/.test(i.statement));
}

export function htmlPreservesAnnotatedTextExpectations(html: string, intents: Intent[]): boolean {
  const expected = collectPatchesFromIntents(intents)
    .map(patch => simpleTextReplacementFromNote(patch.note))
    .filter((value): value is string => Boolean(value));
  if (expected.length === 0) return true;

  const $ = cheerio.load(html, { xml: false });
  const text = normalizeText($('body').text() || $.text());
  return expected.every(value => text.includes(normalizeText(value)));
}

/** 折叠所有空白比较 — pin 的 text 是 80 字截断, 元素 textContent 可能含换行 */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 多策略找元素。返回单一最佳匹配, 或 null。
 *
 *   1. selector 直接命中 1 个 → 用之
 *   2. selector 命中多个 → filter by text (collapse whitespace 比较前 80 字)
 *   3. 仍多 → filter by nearestHeading 上溯匹配
 *   4. 仍多 → 取第一个
 *   5. selector 0 命中 → 退化: 全 doc 找 text 匹配
 *
 * 注: selector 是 darwin-mark.js 启发式产生, 不保证严格 CSS 合法, 容错考虑得多。
 */
function findElement(
  $: CheerioAPI,
  patch: AnnotatedPatch
): Cheerio<AnyNode> | null {
  let candidates: Cheerio<AnyNode>;
  try {
    candidates = $(patch.selector);
  } catch {
    candidates = $('');
  }

  // selector 0 命中 → 退化用 text
  if (candidates.length === 0 && patch.text) {
    const needle = normalizeText(patch.text);
    candidates = $('*').filter((_i, el) => {
      const t = normalizeText($(el).text());
      return t === needle || t.startsWith(needle);
    });
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates.first();

  // 多个候选 → filter by text
  if (patch.text) {
    const needle = normalizeText(patch.text);
    const byText = candidates.filter((_i, el) => {
      const t = normalizeText($(el).text());
      return t === needle || t.startsWith(needle) || t.includes(needle);
    });
    if (byText.length === 1) return byText.first();
    if (byText.length > 0) candidates = byText;
  }

  // 仍多个 → filter by nearestHeading
  if (candidates.length > 1 && patch.nearestHeading) {
    const headingNeedle = normalizeText(patch.nearestHeading);
    const byHeading = candidates.filter((_i, el) => {
      // 找 el 的最近 heading ancestor 的 textContent
      const $el = $(el);
      const $heading = $el.parents().find('h1, h2, h3, h4, h5, h6').last();
      // parents().find() 找的是 ancestor 子树, 这里用 prev / closest 风格
      // cheerio 没有 .closest('h1,h2,...') 那种直接看 ancestor 自身的, 我们手写一遍
      let cur: Element | null = el.parent as Element | null;
      let foundHeading: Element | null = null;
      while (cur && cur.type === 'tag') {
        const sib = $(cur).children('h1, h2, h3, h4, h5, h6').first();
        if (sib.length > 0) { foundHeading = sib.get(0) ?? null; break; }
        cur = cur.parent as Element | null;
      }
      const text = foundHeading ? normalizeText($(foundHeading).text()) : '';
      void $heading;  // 摆设, 避免 unused lint
      return text === headingNeedle || text.includes(headingNeedle) || headingNeedle.includes(text);
    });
    if (byHeading.length === 1) return byHeading.first();
    if (byHeading.length > 0) candidates = byHeading;
  }

  // 取第一个 (warn 由调用方记)
  return candidates.first();
}

export type ApplyPatchesResult = {
  html: string;
  applied: number;
  skipped: number;
  errors: string[];
};

export async function applyAnnotatedPatches(
  existingHtml: string,
  newIntents: Intent[]
): Promise<ApplyPatchesResult> {
  const patches = collectPatchesFromIntents(newIntents);
  if (patches.length === 0) {
    return { html: existingHtml, applied: 0, skipped: 0, errors: ['no patches found'] };
  }

  const $ = cheerio.load(existingHtml, { xml: false });

  // 并行解析 LLM 输出, 但 cheerio 替换需要串行 (避免 selector 在 DOM 变化期间漂)
  // 解法: 先找元素 + 算 outerHTML / contextBefore / contextAfter, 然后并行 LLM,
  // 拿到结果后按原 DOM 顺序串行 replaceWith。replaceWith 之后元素引用仍然指向被换的旧节点 (cheerio API),
  // 但因为我们用了 outerHtml + 替换之前已经把 ref 都拿了, 不会重新找。

  const tasks = patches.map(patch => {
    const $el = findElement($, patch);
    if (!$el || $el.length === 0) {
      return { patch, el: null, outerHtml: '', contextBefore: '', contextAfter: '' };
    }
    const el = $el.get(0);
    if (!el) {
      return { patch, el: null, outerHtml: '', contextBefore: '', contextAfter: '' };
    }
    const outerHtml = $.html($el);
    // 邻居上下文: 用元素在源 HTML 字符串的位置切前 200 / 后 200 字
    const idx = existingHtml.indexOf(outerHtml);
    const contextBefore = idx >= 0 ? existingHtml.slice(Math.max(0, idx - 200), idx) : '';
    const contextAfter = idx >= 0
      ? existingHtml.slice(idx + outerHtml.length, idx + outerHtml.length + 200)
      : '';
    return { patch, el, outerHtml, contextBefore, contextAfter };
  });

  // 并行调 LLM
  const llmResults = await Promise.all(
    tasks.map(async t => {
      if (!t.el) return { task: t, result: null as null | string, error: 'element not found' };
      const deterministic = patchOuterHtmlDeterministically(t.outerHtml, t.patch);
      if (deterministic) return { task: t, result: deterministic, error: null };
      const r = await patchElement({
        outerHtml: t.outerHtml,
        note: t.patch.note,
        contextBefore: t.contextBefore,
        contextAfter: t.contextAfter,
        nearestHeading: t.patch.nearestHeading,
      });
      if (!r.ok) return { task: t, result: null, error: r.error };
      return { task: t, result: r.html, error: null };
    })
  );

  // 串行 replaceWith — cheerio 同一棵 DOM, 替换之间互不依赖只要 ref 拿在前面
  //
  // 每个 pin 独立做大小完整性检查: LLM 拿到容器级元素 (整个 view / section, 几十 KB outerHTML) +
  // 新增功能型注解 (如"请补充 logo 图片") 时, 会倾向于"摘要式"重写, 输出只剩骨架。
  // 检测办法: 替换后 outerHTML 的字节比原 outerHTML 跌到 0.5 以下 → 视为 LLM 偷懒,
  // 跳过这条 pin (不应用), 不影响其他 pin。
  const errors: string[] = [];
  let applied = 0;
  let skipped = 0;
  for (const r of llmResults) {
    if (!r.result || !r.task.el) {
      skipped++;
      errors.push(`pin #${r.task.patch.pinIndex}: ${r.error}`);
      continue;
    }
    const origLen = r.task.outerHtml.length;
    const newLen = r.result.length;
    const elemRatio = origLen > 0 ? newLen / origLen : 1;
    // 容器级 outerHTML 又被 LLM 缩成骨架 — 跳过, 保留原元素不动
    if (elemRatio < 0.5) {
      skipped++;
      errors.push(`pin #${r.task.patch.pinIndex}: LLM 输出大小异常 (${origLen}B → ${newLen}B, ratio=${elemRatio.toFixed(2)}), 已跳过保留原元素`);
      continue;
    }
    // cheerio Cheerio<Element> 需要重新包一遍
    try {
      $(r.task.el).replaceWith(r.result);
      applied++;
    } catch (err) {
      skipped++;
      errors.push(`pin #${r.task.patch.pinIndex}: replaceWith threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // cheerio.html() 默认带 doctype + html + head + body 完整结构 (如果原文档有)
  const out = $.html();
  return { html: out, applied, skipped, errors };
}

/** 判断一组 intent 是否都是纯标注 patch (没有自由文本意图混着) */
export function allIntentsAreAnnotatedPatches(intents: Intent[]): boolean {
  if (intents.length === 0) return false;
  return intents.every(i => hasAnnotatedPatches([i]));
}

function patchOuterHtmlDeterministically(
  outerHtml: string,
  patch: AnnotatedPatch
): string | null {
  const replacement = simpleTextReplacementFromNote(patch.note);
  if (!replacement || !patch.text) return null;

  const $ = cheerio.load(outerHtml, { xml: false }, false);
  const $root = $.root().children().first();
  const root = $root.get(0);
  if (!root) return null;

  const source = patch.text;
  let changed = false;

  if ($root.children().length === 0) {
    const current = normalizeText($root.text());
    const expected = normalizeText(source);
    if (current === expected || current.startsWith(expected) || current.includes(expected)) {
      $root.text(replacement);
      changed = true;
    }
  }

  if (!changed) {
    changed = replaceTextNode(root, source, replacement);
  }

  return changed ? $.html($root) : null;
}

function simpleTextReplacementFromNote(note: string): string | null {
  const trimmed = note.trim();
  const startsAsTextChange = /^(改成|改为|换成|替换成|替换为)\s*/.test(trimmed);
  const namesTextTarget = /(文案|标题|按钮文字|按钮文案|文字|copy|text|label).{0,12}(改成|改为|换成|替换成|替换为)/i.test(trimmed);
  if (!startsAsTextChange && !namesTextTarget) return null;

  const m = trimmed.match(/(?:改成|改为|换成|替换成|替换为)\s*(.+)$/);
  if (!m?.[1]) return null;
  return cleanReplacementText(m[1]);
}

function cleanReplacementText(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[。！]\s*$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function replaceTextNode(node: AnyNode, source: string, replacement: string): boolean {
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  let changed = false;
  for (const child of children) {
    if (child.type === 'text' && typeof child.data === 'string') {
      if (child.data.includes(source)) {
        child.data = child.data.replace(source, replacement);
        changed = true;
      } else if (normalizeText(child.data) === normalizeText(source)) {
        child.data = replacement;
        changed = true;
      }
    } else if (replaceTextNode(child, source, replacement)) {
      changed = true;
    }
  }
  return changed;
}
