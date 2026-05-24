/**
 * Regression guard for screenshot/logo asset repair.
 *
 * The real failure on project 8d72ef5a saved a new version with the same HTML
 * while four relative logo paths still pointed at missing files. This guard
 * checks the deterministic repair layer directly, without LLM or Supabase.
 */

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = await readFile(new URL('../src/lib/asset-repair.ts', import.meta.url), 'utf8');
const tempDir = await mkdtemp(join(process.cwd(), '.tmp-darwin-asset-repair-'));
const jsPath = join(tempDir, 'asset-repair.mjs');

const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    verbatimModuleSyntax: false,
  },
}).outputText;

try {
  await writeFile(jsPath, js);
  const {
    repairAssetsForIntents,
    countLikelyBrokenAssetRefs,
    hasLikelyBrokenAssetRefs,
  } = await import(pathToFileURL(jsPath));

  const existingHtml = `<!doctype html>
<html><head><title>fixture</title></head><body>
<section id="ai-flow">
  <div class="flow-node"><img class="flow-node-logo" src="logo/FChatGPT.svg" alt=""><span>ChatGPT</span></div>
  <div class="flow-node"><img class="flow-node-logo" src="logo/Claude.svg" alt=""><span>Claude</span></div>
  <div class="flow-node"><img class="flow-node-logo" src="logo/Gemini.svg" alt=""><span>Gemini</span></div>
  <div class="flow-node"><img class="flow-node-logo" src="logo/Perplexity.svg" alt=""><span>Perplexity</span></div>
</section>
<section id="pricing"><p>Do not touch pricing.</p></section>
</body></html>`;

  const intent = {
    id: 'intent-logo',
    projectId: 'project',
    authorId: 'user',
    authorKind: 'human',
    statement: '请看我上传的截图的红色框中部分，几个 ai 平台的 logo 都缺失了，请直接补全\n\n【参考图片: image.png】https://example.com/image.png',
    type: 'Constraint',
    scope: 'features',
    weight: 'must',
    createdAt: new Date().toISOString(),
  };

  assert.equal(countLikelyBrokenAssetRefs(existingHtml), 4);
  assert.equal(hasLikelyBrokenAssetRefs(existingHtml), true);

  const repaired = repairAssetsForIntents(existingHtml, [intent]);
  assert.equal(repaired.ok, true, repaired.reason);
  assert.equal(repaired.changed, 4);
  assert.equal(countLikelyBrokenAssetRefs(repaired.html), 0);
  assert.equal(hasLikelyBrokenAssetRefs(repaired.html), false);
  assert.doesNotMatch(repaired.html, /src="logo\/FChatGPT\.svg"/);
  assert.doesNotMatch(repaired.html, /src="logo\/Claude\.svg"/);
  assert.doesNotMatch(repaired.html, /src="logo\/Gemini\.svg"/);
  assert.doesNotMatch(repaired.html, /src="logo\/Perplexity\.svg"/);
  assert.match(repaired.html, /data:image\/svg\+xml,/);
  assert.match(repaired.html, /Do not touch pricing/);

  const staleInlineHtml = `<!doctype html>
<html><head><title>fixture</title></head><body>
<section id="ai-flow">
  <div class="flow-node"><img class="flow-node-logo" src="data:image/svg+xml,%3Csvg%3Ewrong-chatgpt%3C%2Fsvg%3E" alt="logo"><span>ChatGPT</span></div>
  <div class="flow-node"><img class="flow-node-logo" src="data:image/svg+xml,%3Csvg%3Ewrong-claude%3C%2Fsvg%3E" alt="logo"><span>Claude</span></div>
  <div class="flow-node"><img class="flow-node-logo" src="data:image/svg+xml,%3Csvg%3Ewrong-gemini%3C%2Fsvg%3E" alt="logo"><span>Gemini</span></div>
  <div class="flow-node"><img class="flow-node-logo" src="data:image/svg+xml,%3Csvg%3Ewrong-perplexity%3C%2Fsvg%3E" alt="logo"><span>Perplexity</span></div>
</section>
<section id="pricing"><p>Do not touch pricing.</p></section>
</body></html>`;

  const replaceIntent = {
    ...intent,
    id: 'intent-replace-logo',
    statement: '4 个 ai 平台的 logo 都是错的，请替换成正确的官方 logo',
  };
  const replaced = repairAssetsForIntents(staleInlineHtml, [replaceIntent]);
  assert.equal(replaced.ok, true, replaced.reason);
  assert.equal(replaced.changed, 4);
  assert.doesNotMatch(replaced.html, /wrong-chatgpt|wrong-claude|wrong-gemini|wrong-perplexity/);
  assert.match(replaced.html, /OpenAI/);
  assert.match(replaced.html, /Claude/);
  assert.match(replaced.html, /Google%20Gemini/);
  assert.match(replaced.html, /Perplexity/);
  assert.match(replaced.html, /Do not touch pricing/);

  const secondPass = repairAssetsForIntents(replaced.html, [replaceIntent]);
  assert.equal(secondPass.ok, false, 'canonical logo replacement should be idempotent');

  console.log('asset-repair guard: ok');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
