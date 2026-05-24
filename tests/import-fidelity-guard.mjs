/**
 * Static guard for imported HTML fidelity.
 *
 * The nohi.ai clone failure was not an LLM truncation issue. The stored v1 was
 * essentially the imported HTML, but source framework scripts were stripped, so
 * scroll-reveal classes such as opacity-0/translate-y-* never became visible.
 * Also, preview-time link rewriting turned source subpage links into dead hash
 * anchors. This guard keeps the preview layer honest.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const canvas = await readFile(
  new URL('../src/components/ProjectCanvas.tsx', import.meta.url),
  'utf8'
);
const importer = await readFile(
  new URL('../src/lib/fetch-imported-html.ts', import.meta.url),
  'utf8'
);

assert.match(
  canvas,
  /const IMPORT_STATIC_FIDELITY_SCRIPT = `[\s\S]*?opacity-0[\s\S]*?translate-y-[\s\S]*?darwin-import-revealed[\s\S]*?`;/,
  'ProjectCanvas must inject a static reveal fallback for raw imported HTML'
);
assert.match(
  canvas,
  /function looksLikeRawImportedHtml\(html: string, sourceUrl\?: string \| null\): boolean[\s\S]*?data-scope/,
  'ProjectCanvas must distinguish raw imported HTML from Darwin-generated HTML'
);
assert.match(
  canvas,
  /if \(rawImportedHtml && sourceOrigin\) \{[\s\S]*?sourceHref\(cleanedHref\)/,
  'raw imported same-origin relative links must remain navigable to source subpages'
);
assert.match(
  canvas,
  /function buildImportArchiveRouterScript\(sourceUrl\?: string \| null\): string[\s\S]*?template\[data-darwin-imported-page\]\[data-url\][\s\S]*?renderArchivedPage/,
  'raw imported HTML with archived subpages must get an iframe-local archive router'
);
assert.match(
  canvas,
  /data-darwin-import-archive-router/,
  'ProjectCanvas must inject the imported subpage archive router'
);
assert.match(
  canvas,
  /if \(rawImportedHtml\) \{[\s\S]*?escapeAttr\(u\.href\)/,
  'raw imported same-origin absolute links must not be rewritten to hash anchors'
);
assert.match(
  canvas,
  /if \(cleanedHref\.startsWith\('\/'\)\) return `<a\$\{beforeC\} href="\$\{pathToAnchor\(cleanedHref\)\}"\$\{afterC\}>`;/,
  'Darwin-generated pages must still rewrite same-origin paths to hash anchors'
);

assert.match(
  importer,
  /const MAX_IMPORTED_SUBPAGES = 8;/,
  'URL imports should crawl a bounded number of same-origin subpages'
);
assert.match(
  importer,
  /function discoverSameOriginSubpageUrls\(sourceUrl: string, html: string\): string\[\][\s\S]*?u\.host\.toLowerCase\(\) !== source\.host\.toLowerCase\(\)/,
  'subpage discovery must stay same-origin'
);
assert.match(
  importer,
  /<template data-darwin-imported-page data-url="\$\{escapeAttr\(page\.url\)\}"/,
  'fetched subpages must be stored inertly in the imported reference HTML'
);
assert.match(
  importer,
  /fetchSameOriginSubpages\(\{[\s\S]*?sourceHtml: html,[\s\S]*?availableChars: subpageBudget/,
  'fetchImportedHtml must append discovered subpages within the HTML budget'
);

console.log('import-fidelity guard: ok');
