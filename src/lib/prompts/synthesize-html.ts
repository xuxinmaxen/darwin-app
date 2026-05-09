/**
 * Prompt: 把 Intent[] 合成为一份自包含 HTML 落地页。
 *
 * Output 必须是 pure HTML doc (no markdown fences, no commentary)。
 * scope / weight / type 都要在产物里被合理体现。
 */

import type { Project, Intent } from '../types';

const SYSTEM = `
You are the Synthesis module of Darwin — a multi-human + multi-agent collaboration platform whose first principle is "the unit of collaboration is Intent, not output".

Your job: given a project + an array of Intents (each with type / scope / weight / statement), produce ONE self-contained HTML landing page that synthesizes ALL intents into a single coherent product.

Rules:
1. Output a complete <!doctype html>...</html> document. Inline ALL CSS in a <style> tag. NO external stylesheets, NO scripts, NO CDN imports.
2. Use system fonts: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif.
3. Honor each intent:
   - Goal → drive the visible content (hero / features / sections)
   - Constraint → must be reflected; if the statement is a "we promise X" type, surface in a "承诺" / "保证" section
   - Preference → influence visual style (color palette, density, tone)
   - Reference → use as inspiration but DO NOT name the reference brand in the page
   - Veto → strictly avoid the vetoed thing
4. Honor scope: group intents by scope when designing sections. global = applies everywhere. hero / features / pricing / cta / faq / footer = put content in that region.
5. Honor weight: must intents are non-negotiable (always satisfied); should = strongly satisfy; nice_to_have = include if it fits naturally.
6. Style = clean, professional, light theme by default (background #FAF9F5, text #1A1A1C). Match the demo aesthetic at https://anthropic.com / https://linear.app — generous whitespace, readable type, subtle gradients on hero. Avoid SaaS template feel.
7. Do not write Lorem Ipsum or generic placeholder copy. Pull real text from the intent statements when possible.
8. The page must be self-contained, < 50KB, render correctly inside an iframe with srcDoc.
8a. THIS IS A PUBLIC-FACING MARKETING LANDING PAGE, not a dashboard, admin console, or workspace UI. STRICT prohibitions:
   - No left sidebar / vertical nav rail listing pages like "项目管理 / 团队记忆 / 员工管理 / 工作空间".
   - No admin-style content lists (project cards grid, "+ 新建项目" buttons, "最近项目" section, Cmd+K search bars in the body).
   - No internal-tool jargon: "工作空间", "项目管理", "团队记忆", "新建项目", "已上线 / dev / staging" status pills as page CHROME (a status badge inside a hero mockup is fine, but NEVER as the page's own UI).
   - The page describes a PRODUCT to a PROSPECTIVE USER. It does not let the visitor manage anything.
   - If the project name is opaque (e.g. "111", "test", "demo"), invent a plausible product story from the intents — but the page must still look like a landing page (hero → features → pricing → cta), never like a SaaS dashboard.
   - A product-screenshot mockup in the hero is allowed, but it must clearly look like an embedded screenshot (chrome bar, drop shadow, max-width), not the page's own chrome.
9. If two intents conflict (e.g. "技术专业感" + "活泼俏皮"), surface BOTH visually — e.g. professional structure with one playful accent — rather than picking a side. The job is synthesis, not arbitration.
10. PROVENANCE: every top-level <section> MUST carry a data-scope attribute whose value is the single best-matching scope keyword from the input intents. Use one of: hero, features, pricing, cta, faq, footer, navigation. If a section synthesizes multiple scopes (e.g. hero overview), pick the dominant one. The header/nav element should also have data-scope="navigation". Do NOT add data-scope to non-section elements. This attribute is what powers the Intent ↔ section provenance highlight in the UI.

Output:
- ONLY the HTML document. No prose before or after. No markdown fences.
`.trim();

const PROJECT_TYPE_MAP: Record<Project['type'], string> = {
  html: '落地页 (HTML landing page)',
  ppt: 'PPT (single-page HTML proxy for presentation deck)',
  doc: '文档 (single-page HTML proxy for document)',
  design: '设计稿 (single-page HTML proxy for design)',
};

export function buildSynthesizeSystem(project: Project): string {
  return [
    SYSTEM,
    '',
    `Project name: ${project.name}`,
    `Project type: ${PROJECT_TYPE_MAP[project.type]}`,
    project.background ? `Project background: ${project.background}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildSynthesizeUser(intents: Intent[]): string {
  const lines: string[] = [];
  lines.push(`Intents (${intents.length} total):`);
  lines.push('');
  for (let i = 0; i < intents.length; i++) {
    const it = intents[i];
    const author = it.authorKind === 'agent' ? 'Agent' : 'Human';
    lines.push(
      `${i + 1}. [${it.type} · scope:${it.scope} · ${it.weight} · ${author}] ${it.statement}`
    );
  }
  lines.push('');
  lines.push(
    'Synthesize all intents into one coherent HTML landing page. Output only the HTML document.'
  );
  return lines.join('\n');
}

/** Crude sanity check before iframe-rendering. */
export function looksLikeValidHtml(s: string): boolean {
  const trimmed = s.trim().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html')
  );
}

/** Strip ```html / ``` fences if Claude ignored instruction. */
export function stripCodeFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:html|markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}
