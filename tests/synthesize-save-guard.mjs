/**
 * Static guard for "no fake success version" behavior.
 *
 * If synthesis returns byte-identical HTML, the API route must reject the save
 * instead of inserting another version with unchanged content.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route = await readFile(
  new URL('../src/app/api/projects/[id]/synthesize/route.ts', import.meta.url),
  'utf8'
);
const synth = await readFile(new URL('../src/lib/synthesize.ts', import.meta.url), 'utf8');
const canvas = await readFile(new URL('../src/components/ProjectCanvas.tsx', import.meta.url), 'utf8');

assert.match(route, /sameHtml\(latestVersion\.content,\s*result\.content\)/, 'non-stream route must compare latest and result HTML before createVersion');
assert.match(route, /unchanged:\s*true/, 'non-stream unchanged response must expose unchanged=true');
assert.match(route, /status:\s*422/, 'unchanged non-stream response must use a non-success status');
assert.match(route, /sameHtml\(latestVersion\.content,\s*finalHtml\)/, 'stream route must compare latest and final HTML before createVersion');
assert.match(route, /finishSynthesisJob\(projectId,\s*\{\s*phase:\s*'error'/, 'stream unchanged path must finish job as error');
assert.match(route, /createHash\('sha256'\)/, 'route must use stable hash comparison for HTML equality');

assert.match(synth, /if \(newIntents\.length === 0\)/, 'synthesize must not full-regenerate when existing version has no new intents');
assert.match(synth, /applyAssetRepairStep\(existing\.html,\s*newIntents\)/, 'synthesize must run deterministic asset repair before LLM free-text patching');
assert.match(synth, /images:\s*imageInputsForIntents\(newIntents\)/, 'incremental LLM path must pass real image references');
assert.doesNotMatch(synth, /!kinds\.has\('text_replace'\)/, 'logo replacement language must still be satisfiable by deterministic asset repair');

assert.match(canvas, /let evt:[\s\S]*?JSON\.parse\(dataLine\.slice\(6\)\)[\s\S]*?continue;[\s\S]*?evt\.type === 'error'[\s\S]*?throw new Error/, 'ProjectCanvas must not swallow parsed SSE error events');
assert.match(canvas, /function resetStreamState\(\)/, 'ProjectCanvas must have one reset path for failed or saved streams');
assert.match(canvas, /onSynthesisError\?\.\(message\)/, 'ProjectCanvas must notify parent when SSE synthesis errors');
assert.match(canvas, /canvas-synthesis-banner/, 'ProjectCanvas must show synthesis errors in one top banner');
assert.doesNotMatch(canvas, /canvas-result-error/, 'ProjectCanvas must not render a second bottom synthesis error block');

console.log('synthesize-save guard: ok');
