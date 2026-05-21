/**
 * Surgical incremental editing for free-text intents.
 *
 * The old incremental path handed the full HTML document to the LLM and asked it
 * to "make minimal changes". That is a soft contract: the model can still
 * restyle or regroup unrelated sections while keeping roughly the same byte
 * size. This module turns the contract into a server-side boundary:
 *
 *   1. Build a compact DOM map of editable regions.
 *   2. Ask the LLM for a JSON edit plan (no HTML).
 *   3. Patch only the selected region outerHTML.
 *   4. Reject the result if any non-target region changed.
 */

import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Intent, Project } from './types';
import { callLLM, callLLMJSON, llmProvider } from './llm';
import { stripCodeFences } from './prompts/synthesize-html';

type DomRegion = {
  key: string;
  tag: string;
  selector: string;
  dataScope: string | null;
  id: string | null;
  className: string | null;
  heading: string;
  text: string;
  buttons: string[];
  images: string[];
};

type EditPlanTarget = {
  key: string;
  selector?: string;
  operation?: 'modify' | 'add_inside' | 'replace_text';
  reason?: string;
};

type EditPlan = {
  mode: 'patch' | 'global_rewrite' | 'no_op';
  confidence?: number;
  targets?: EditPlanTarget[];
  reason?: string;
};

export type SurgicalEditResult =
  | {
      ok: true;
      html: string;
      reason: string;
      changedKeys: string[];
    }
  | {
      ok: false;
      reason: string;
      /** Explicitly let synthesize.ts fall back to the old full-document LLM path. */
      allowFullRewrite?: boolean;
    };

const MAX_DOM_REGIONS = 80;
const MAX_PATCH_REGION_CHARS = Number(process.env.DARWIN_MAX_PATCH_REGION_CHARS) || 55_000;
const PATCH_REGION_TIMEOUT_MS = Number(process.env.DARWIN_PATCH_REGION_TIMEOUT_MS) || 70_000;
const PLAN_TIMEOUT_MS = Number(process.env.DARWIN_EDIT_PLAN_TIMEOUT_MS) || 20_000;

const FULL_REWRITE_RE =
  /(整体|全站|全局|所有模块|全部模块|所有页面|整个页面|整页|统一(一下)?(风格|视觉|设计|排版|颜色)|重做|重新设计|重新生成|大改|整体重构|从头来过|full\s*rewrite|redesign\s+the\s+whole|rewrite\s+the\s+whole)/i;

const PLACEHOLDER_RE =
  /patch not applied|budget exceeded|existing HTML preserved|rest of HTML omitted|<!--\s*(unchanged|rest omitted|existing)/i;

export async function trySurgicalIncrementalUpdate(
  project: Project,
  newIntents: Intent[],
  existingHtml: string
): Promise<SurgicalEditResult> {
  if (newIntents.length === 0) {
    return { ok: false, reason: '没有新增 intent' };
  }

  if (isExplicitFullRewrite(newIntents)) {
    return {
      ok: false,
      allowFullRewrite: true,
      reason: '用户明确要求整体/全站级修改,允许走完整增量重写',
    };
  }

  if (!llmProvider()) {
    return {
      ok: false,
      reason: '未配置 LLM,为避免破坏现有产物,保留上一版',
    };
  }

  const regions = buildDomRegions(existingHtml);
  if (regions.length === 0) {
    return {
      ok: false,
      reason: '当前 HTML 没有可定位的 section/header/footer 区域,保留上一版',
    };
  }

  const plan = await createEditPlan(project, newIntents, regions);
  if (plan.mode === 'global_rewrite') {
    return {
      ok: false,
      allowFullRewrite: true,
      reason: plan.reason || '编辑计划判定为全局修改',
    };
  }
  if (plan.mode !== 'patch') {
    return {
      ok: false,
      reason: plan.reason || '未能把这条意图定位到具体区域,保留上一版',
    };
  }

  const targets = normalizePlanTargets(plan, regions);
  if (targets.length === 0) {
    return {
      ok: false,
      reason: plan.reason || '编辑计划没有返回有效目标区域,保留上一版',
    };
  }

  const $ = cheerio.load(existingHtml, { xml: false });
  const changedKeys: string[] = [];
  const errors: string[] = [];

  for (const target of targets) {
    const region = regions.find(r => r.key === target.key);
    if (!region) {
      errors.push(`${target.key}: target not found`);
      continue;
    }

    const $el = selectRegion($, region);
    if ($el.length === 0) {
      errors.push(`${region.key}: selector missed`);
      continue;
    }

    const outerHtml = $.html($el);
    if (!outerHtml || outerHtml.length > MAX_PATCH_REGION_CHARS) {
      errors.push(
        `${region.key}: 目标区域过大 (${outerHtml?.length ?? 0} chars),需要用标注定位到更小元素`
      );
      continue;
    }

    const patched = await patchRegion({
      project,
      intents: newIntents,
      region,
      outerHtml,
      planReason: target.reason || plan.reason || '',
    });
    if (!patched.ok) {
      errors.push(`${region.key}: ${patched.error}`);
      continue;
    }

    try {
      $el.replaceWith(patched.html);
      changedKeys.push(region.key);
    } catch (err) {
      errors.push(`${region.key}: replace failed (${errMsg(err)})`);
    }
  }

  if (changedKeys.length === 0) {
    return {
      ok: false,
      reason: `没有任何局部修改被安全应用${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`,
    };
  }

  const output = $.html();
  const guard = verifyUnchangedOutsideTargets(existingHtml, output, new Set(changedKeys));
  if (!guard.ok) {
    return {
      ok: false,
      reason: `结构守门拒绝保存: ${guard.reason}`,
    };
  }

  return {
    ok: true,
    html: output,
    changedKeys,
    reason: `局部修改已应用到 ${changedKeys.join(', ')}${errors.length ? `; skipped: ${errors.slice(0, 2).join(' | ')}` : ''}`,
  };
}

function isExplicitFullRewrite(intents: Intent[]): boolean {
  return intents.some(intent => FULL_REWRITE_RE.test(intent.statement));
}

async function createEditPlan(
  project: Project,
  intents: Intent[],
  regions: DomRegion[]
): Promise<EditPlan> {
  const heuristic = heuristicPlan(intents, regions);

  try {
    const plan = await Promise.race([
      callLLMJSON<EditPlan>({
        system: buildEditPlanSystem(),
        user: buildEditPlanUser(project, intents, regions, heuristic),
        maxTokens: 1200,
        temperature: 0,
        tier: 'fast',
      }),
      timeout(PLAN_TIMEOUT_MS, 'edit-plan 超时'),
    ]);
    if (isValidEditPlan(plan)) return plan;
    return heuristic;
  } catch (err) {
    console.warn('[surgical-edit] edit-plan failed, using heuristic:', errMsg(err));
    return heuristic;
  }
}

function buildEditPlanSystem(): string {
  return [
    'You are Darwin Edit Planner. You DO NOT write HTML.',
    '',
    'Task: choose the smallest existing DOM region that should be patched for the new intent.',
    '',
    'Hard rules:',
    '1. Return JSON only.',
    '2. Default to patching one existing region. Do not choose global_rewrite unless the user explicitly asks for a whole-page/global redesign.',
    '3. If the user says to edit a logo, image, button, price, FAQ item, CTA, hero copy, or one feature, target the region that contains that thing.',
    '4. If the intent is ambiguous and no region is plausible, return no_op.',
    '5. Never target unrelated sibling regions just to make the page visually consistent.',
    '',
    'Schema:',
    '{"mode":"patch"|"global_rewrite"|"no_op","confidence":0-1,"targets":[{"key":"region key","operation":"modify"|"add_inside"|"replace_text","reason":"why"}],"reason":"short reason"}',
  ].join('\n');
}

function buildEditPlanUser(
  project: Project,
  intents: Intent[],
  regions: DomRegion[],
  heuristic: EditPlan
): string {
  return [
    `Project: ${project.name} (${project.type})`,
    '',
    'New intents:',
    ...intents.map((it, idx) =>
      `${idx + 1}. [${it.type} · scope:${it.scope} · ${it.weight} · ${it.authorKind}] ${clip(it.statement, 900)}`
    ),
    '',
    'Available DOM regions (choose key from this list):',
    JSON.stringify(regions.map(r => ({
      key: r.key,
      selector: r.selector,
      tag: r.tag,
      dataScope: r.dataScope,
      id: r.id,
      className: r.className,
      heading: r.heading,
      text: r.text,
      buttons: r.buttons,
      images: r.images,
    })), null, 2),
    '',
    `Heuristic suggestion: ${JSON.stringify(heuristic)}`,
    '',
    'Return the edit plan JSON now.',
  ].join('\n');
}

function isValidEditPlan(x: unknown): x is EditPlan {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!['patch', 'global_rewrite', 'no_op'].includes(String(o.mode))) return false;
  if (o.targets !== undefined && !Array.isArray(o.targets)) return false;
  return true;
}

function normalizePlanTargets(plan: EditPlan, regions: DomRegion[]): EditPlanTarget[] {
  const keys = new Set(regions.map(r => r.key));
  const targets = (plan.targets ?? [])
    .filter(t => t && typeof t.key === 'string' && keys.has(t.key))
    .slice(0, 2);
  return dedupeBy(targets, t => t.key);
}

function heuristicPlan(intents: Intent[], regions: DomRegion[]): EditPlan {
  const candidates = new Map<string, number>();

  for (const intent of intents) {
    const statement = normalizeText(intent.statement).toLowerCase();
    const scopeHead = intent.scope === 'global' ? '' : intent.scope.split('.')[0].toLowerCase();

    for (const region of regions) {
      let score = 0;
      const haystack = [
        region.key,
        region.selector,
        region.dataScope,
        region.id,
        region.className,
        region.heading,
        region.text,
        region.buttons.join(' '),
        region.images.join(' '),
      ].filter(Boolean).join(' ').toLowerCase();

      if (scopeHead && (
        region.dataScope?.toLowerCase() === scopeHead ||
        region.id?.toLowerCase().includes(scopeHead) ||
        region.heading.toLowerCase().includes(scopeHead)
      )) {
        score += 8;
      }

      for (const keyword of keywordsFor(statement)) {
        if (haystack.includes(keyword)) score += 3;
      }

      if (/logo|图标|图片|image|icon/.test(statement) && region.images.length > 0) score += 3;
      if (/按钮|button|cta|链接|link/.test(statement) && region.buttons.length > 0) score += 3;
      if (/导航|nav|菜单|header|顶部/.test(statement) && /header|nav|navigation/.test(region.key)) score += 6;
      if (/页脚|footer/.test(statement) && /footer/.test(region.key)) score += 6;

      if (score > 0) candidates.set(region.key, (candidates.get(region.key) ?? 0) + score);
    }
  }

  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || ranked[0][1] < 3) {
    return { mode: 'no_op', confidence: 0.2, reason: 'heuristic could not locate a concrete region' };
  }

  return {
    mode: 'patch',
    confidence: Math.min(0.9, ranked[0][1] / 16),
    targets: [{ key: ranked[0][0], operation: 'modify', reason: `heuristic score ${ranked[0][1]}` }],
    reason: 'heuristic selected the most relevant region',
  };
}

function keywordsFor(statement: string): string[] {
  const dict: Array<[RegExp, string[]]> = [
    [/hero|首屏|头图|主标题|slogan|标题/, ['hero', 'headline', 'slogan']],
    [/feature|功能|能力|卖点/, ['feature', 'features', '功能', '能力']],
    [/price|pricing|定价|价格|套餐/, ['pricing', 'price', '定价', '价格']],
    [/cta|按钮|注册|试用|预约|联系/, ['cta', 'button', '注册', '试用', '联系']],
    [/faq|问题|问答/, ['faq', 'question', '问题']],
    [/footer|页脚/, ['footer', '页脚']],
    [/logo|图标|icon/, ['logo', 'icon', '图标']],
    [/图片|image|img|照片|配图/, ['image', 'img', '图片']],
    [/导航|菜单|nav|header|顶部/, ['navigation', 'nav', 'header', '导航']],
  ];
  const out: string[] = [];
  for (const [re, words] of dict) {
    if (re.test(statement)) out.push(...words);
  }
  // Also include meaningful latin words from the statement, e.g. ChatGPT / Claude.
  for (const m of statement.matchAll(/[a-z][a-z0-9_-]{2,}/gi)) {
    out.push(m[0].toLowerCase());
  }
  return dedupe(out).slice(0, 16);
}

async function patchRegion(input: {
  project: Project;
  intents: Intent[];
  region: DomRegion;
  outerHtml: string;
  planReason: string;
}): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  try {
    const maxTokens = Math.min(
      20_000,
      Math.max(3_000, Math.ceil(input.outerHtml.length / 3) + 1_000)
    );
    const raw = await Promise.race([
      callLLM({
        system: buildPatchRegionSystem(),
        user: buildPatchRegionUser(input),
        maxTokens,
        temperature: 0.1,
        tier: 'full',
      }),
      timeout(PATCH_REGION_TIMEOUT_MS, 'patch-region 超时'),
    ]);
    const cleaned = stripCodeFences(raw).trim();
    const validation = validatePatchedRegion(input.outerHtml, cleaned);
    if (!validation.ok) return { ok: false, error: validation.reason };
    return { ok: true, html: cleaned };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

function buildPatchRegionSystem(): string {
  return [
    'You patch exactly ONE existing HTML region.',
    '',
    'Input is the outerHTML of one region (header/nav/section/footer) and new user intents.',
    'Output must be the full outerHTML of that SAME region after applying the intents.',
    '',
    'Hard rules:',
    '1. Output raw HTML only. No markdown fences. No prose. No comments like "unchanged".',
    '2. Keep the same outer tag and preserve its id/class/data-* attributes unless the intent explicitly edits them.',
    '3. Apply only the requested local change inside this region.',
    '4. Do not redesign the region for consistency. Do not rewrite sibling sections; you cannot see them and must not imply changes to them.',
    '5. Preserve all unrelated copy, links, images, scripts, data attributes, hidden states, and child order inside the region.',
    '6. If the intent is too ambiguous for this region, return the input region unchanged.',
  ].join('\n');
}

function buildPatchRegionUser(input: {
  project: Project;
  intents: Intent[];
  region: DomRegion;
  outerHtml: string;
  planReason: string;
}): string {
  return [
    `Project: ${input.project.name}`,
    `Target region: ${input.region.key} (${input.region.selector})`,
    input.planReason ? `Why this region was selected: ${input.planReason}` : '',
    '',
    'New intents:',
    ...input.intents.map((it, idx) =>
      `${idx + 1}. [${it.type} · scope:${it.scope} · ${it.weight} · ${it.authorKind}] ${it.statement}`
    ),
    '',
    'Region outerHTML to patch:',
    '```html',
    input.outerHtml,
    '```',
    '',
    'Return the complete patched outerHTML for this same region only.',
  ].filter(Boolean).join('\n');
}

function validatePatchedRegion(
  original: string,
  patched: string
): { ok: true } | { ok: false; reason: string } {
  if (!patched.startsWith('<')) return { ok: false, reason: 'patch output is not HTML' };
  if (PLACEHOLDER_RE.test(patched)) return { ok: false, reason: 'patch output contains placeholder text' };

  const origTag = firstTagName(original);
  const newTag = firstTagName(patched);
  if (!origTag || !newTag || origTag !== newTag) {
    return { ok: false, reason: `outer tag changed (${origTag} -> ${newTag})` };
  }

  const ratio = patched.length / original.length;
  if (ratio < 0.55) return { ok: false, reason: `target region shrank too much (${ratio.toFixed(2)})` };
  if (ratio > 1.85) return { ok: false, reason: `target region grew too much (${ratio.toFixed(2)})` };

  return { ok: true };
}

function verifyUnchangedOutsideTargets(
  beforeHtml: string,
  afterHtml: string,
  changedKeys: Set<string>
): { ok: true } | { ok: false; reason: string } {
  if (PLACEHOLDER_RE.test(afterHtml)) {
    return { ok: false, reason: '输出含占位/省略文本' };
  }

  const before = fingerprintDocument(beforeHtml);
  const after = fingerprintDocument(afterHtml);

  if (before.headHash !== after.headHash) {
    return { ok: false, reason: 'head/style/script 发生了非目标修改' };
  }
  if (before.units.length !== after.units.length) {
    return { ok: false, reason: `区域数量变化 (${before.units.length} -> ${after.units.length})` };
  }

  for (let i = 0; i < before.units.length; i++) {
    const a = before.units[i];
    const b = after.units[i];
    if (!a || !b || a.key !== b.key || a.tag !== b.tag) {
      return { ok: false, reason: `区域顺序/身份变化 at ${i}` };
    }
    if (!changedKeys.has(a.key) && a.hash !== b.hash) {
      return { ok: false, reason: `非目标区域被修改: ${a.key}` };
    }
  }

  const ratio = afterHtml.length / beforeHtml.length;
  if (ratio < 0.8 || ratio > 1.35) {
    return { ok: false, reason: `整页大小异常 (${(ratio * 100).toFixed(0)}%)` };
  }

  return { ok: true };
}

function fingerprintDocument(html: string): {
  headHash: string;
  units: Array<{ key: string; tag: string; hash: string }>;
} {
  const $ = cheerio.load(html, { xml: false });
  const headHash = hash($.html($('head')) || '');
  const units = buildDomRegionsFromCheerio($).map(region => {
    const outer = $.html(selectRegion($, region));
    return { key: region.key, tag: region.tag, hash: hash(outer || '') };
  });
  return { headHash, units };
}

function buildDomRegions(html: string): DomRegion[] {
  return buildDomRegionsFromCheerio(cheerio.load(html, { xml: false }));
}

function buildDomRegionsFromCheerio($: CheerioAPI): DomRegion[] {
  const raw: DomRegion[] = [];
  const seen = new Set<Element>();
  const selectors = [
    'body > header',
    'body > nav',
    'body > main > header',
    'body > main > nav',
    'section',
    'footer',
    // Imported prototypes often use app-like containers instead of <section>.
    // Prefer named top-level / view containers over falling all the way back to
    // <body>, otherwise a local request becomes too large to patch safely.
    'body > main > [id]',
    'body > main > [data-scope]',
    'body > div[id]',
    'body > div[data-scope]',
    '[id^="view-"]',
    '[data-scope]',
  ];

  for (const selector of selectors) {
    $(selector).each((_idx, el) => {
      if (!isElement(el)) return;
      if (seen.has(el)) return;
      seen.add(el);
      raw.push(regionFromElement($, el, raw.length));
    });
  }

  if (raw.length === 0) {
    const body = $('body').get(0);
    if (body && isElement(body)) raw.push(regionFromElement($, body, 0));
  }

  return raw.slice(0, MAX_DOM_REGIONS);
}

function regionFromElement($: CheerioAPI, el: Element, index: number): DomRegion {
  const $el = $(el);
  const tag = el.tagName.toLowerCase();
  const id = attr($el, 'id');
  const dataScope = attr($el, 'data-scope');
  const className = attr($el, 'class');
  const heading = normalizeText($el.find('h1,h2,h3,h4,h5,h6').first().text()).slice(0, 160);
  const text = normalizeText($el.text()).slice(0, 520);
  const buttons = $el.find('a,button')
    .map((_i, node) => normalizeText($(node).text()).slice(0, 80))
    .get()
    .filter(Boolean)
    .slice(0, 10);
  const images = $el.find('img,svg')
    .map((_i, node) => {
      const $node = $(node);
      return attr($node, 'alt') || attr($node, 'aria-label') || attr($node, 'src') || node.tagName;
    })
    .get()
    .filter(Boolean)
    .slice(0, 10);
  return {
    key: `${tag}:${dataScope || id || index}:${index}`,
    tag,
    selector: selectorFor(el, index),
    dataScope,
    id,
    className,
    heading,
    text,
    buttons,
    images,
  };
}

function selectorFor(el: Element, index: number): string {
  const tag = el.tagName.toLowerCase();
  const id = el.attribs?.id;
  const dataScope = el.attribs?.['data-scope'];
  if (id) return `#${cssEscape(id)}`;
  if (dataScope) return `${tag}[data-scope="${dataScope.replace(/"/g, '\\"')}"]`;
  return `${tag}:eq(${index})`;
}

function isElement(node: unknown): node is Element {
  return Boolean(
    node &&
    typeof node === 'object' &&
    (node as { type?: unknown }).type === 'tag' &&
    typeof (node as { tagName?: unknown }).tagName === 'string'
  );
}

function selectRegion($: CheerioAPI, region: DomRegion) {
  if (region.id) return $(`#${cssEscape(region.id)}`).first();
  if (region.dataScope) return $(`${region.tag}[data-scope="${region.dataScope.replace(/"/g, '\\"')}"]`).first();
  const idx = Number(region.key.split(':').at(-1) ?? 0);
  return $(region.tag).eq(idx);
}

function attr($el: ReturnType<CheerioAPI>, name: string): string | null {
  const v = $el.attr(name);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function firstTagName(html: string): string | null {
  const m = html.trim().match(/^<([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function cssEscape(s: string): string {
  return s.replace(/([ #.;?+*~':"!^$[\]()=>|/@])/g, '\\$1');
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
