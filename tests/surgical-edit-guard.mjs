/**
 * Static guard for the surgical incremental edit implementation.
 *
 * This does not call LLM or Supabase. It checks that the code path that replaces
 * full-document incremental rewrite is present and that the guard keeps the old
 * fallback behind an explicit allowFullRewrite gate.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const synth = await readFile(new URL('../src/lib/synthesize.ts', import.meta.url), 'utf8');
const surgical = await readFile(new URL('../src/lib/surgical-edit.ts', import.meta.url), 'utf8');

assert.match(
  synth,
  /import \{ trySurgicalIncrementalUpdate \} from '\.\/surgical-edit';/,
  'synthesize.ts must import the surgical edit path'
);

const callCount = (synth.match(/trySurgicalIncrementalUpdate\(project, newIntents, existing\.html\)/g) || []).length;
assert.equal(callCount, 2, 'synthesize.ts must call surgical edit in non-stream and stream incremental paths');

assert.match(
  synth,
  /if \(!surgical\.allowFullRewrite\)[\s\S]*?content: existing\.html/,
  'non-stream path must keep existing HTML when surgical edit refuses'
);

assert.match(
  synth,
  /if \(!surgical\.allowFullRewrite\)[\s\S]*?type: 'chunk', content: existing\.html/,
  'stream path must stream existing HTML when surgical edit refuses'
);

assert.match(
  surgical,
  /verifyUnchangedOutsideTargets/,
  'surgical edit must verify unchanged non-target regions before saving'
);

assert.match(
  surgical,
  /headHash !== after\.headHash/,
  'surgical edit must reject unexpected head/style/script changes'
);

assert.match(
  surgical,
  /非目标区域被修改/,
  'surgical edit must reject non-target region mutations'
);

assert.match(
  surgical,
  /FULL_REWRITE_RE/,
  'surgical edit must require explicit full-rewrite language before global rewrite'
);

console.log('surgical-edit guard: ok');
