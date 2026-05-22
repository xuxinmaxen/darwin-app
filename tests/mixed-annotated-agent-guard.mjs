/**
 * Regression guard for project 8d72ef5a:
 * a human annotated text edit plus a same-batch agent suggestion must not skip
 * the annotated edit. Agent suggestions may be integrated only if they do not
 * overwrite the human's precise patch.
 */

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = await readFile(new URL('../src/lib/patches.ts', import.meta.url), 'utf8');
const tempDir = await mkdtemp(join(process.cwd(), '.tmp-darwin-patches-'));
const jsPath = join(tempDir, 'patches.mjs');

const patchedSrc = src.replace(
  "import { patchElement } from './patch-element';",
  'const patchElement = async () => { throw new Error("LLM patch should not be called for simple text replacement"); };'
);

const js = ts.transpileModule(patchedSrc, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    verbatimModuleSyntax: false,
  },
}).outputText;

try {
  await writeFile(jsPath, js);
  const { applyAnnotatedPatches, htmlPreservesAnnotatedTextExpectations } = await import(pathToFileURL(jsPath));

  const existingHtml = `<!doctype html>
<html><head><title>fixture</title></head><body>
<section id="view-welcome-plan"><h1>Your products, founded by AI</h1><p>Keep this module stable.</p></section>
<section id="pricing"><h2>Pricing</h2><p>Do not touch pricing.</p></section>
</body></html>`;

  const humanIntent = {
    id: 'human-1',
    statement: '【标注修改】\n1. [h1 · "Your products, founded by AI" · at: #view-welcome-plan > div.view-inner > div.shell-wide > div.welcome-hero] 改成 Your store, founded by AI',
  };
  const agentIntent = {
    id: 'agent-1',
    statement: '建议确认这里是否应写作“Your store, found by AI”，因为“founded by AI”更像是在说店铺由 AI 创办。',
  };

  const patched = await applyAnnotatedPatches(existingHtml, [humanIntent]);

  assert.equal(patched.applied, 1, patched.errors.join(' | '));
  assert.match(patched.html, /Your store, founded by AI/);
  assert.doesNotMatch(patched.html, /Your products, founded by AI/);
  assert.match(patched.html, /Do not touch pricing/);
  assert.equal(htmlPreservesAnnotatedTextExpectations(patched.html, [humanIntent]), true);
  assert.equal(htmlPreservesAnnotatedTextExpectations(patched.html.replace('founded', 'found'), [humanIntent]), false);
  assert.equal(htmlPreservesAnnotatedTextExpectations(patched.html, [agentIntent]), true);

  console.log('mixed-annotated-agent guard: ok');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
