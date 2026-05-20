/**
 * Annotated-patch e2e — 验证服务端 cheerio + LLM 小补丁路径真的能做精准修改,
 * 不再像之前那样让 LLM 输出整页占位 stub 导致整页崩塌。
 *
 * 单轮流程:
 *   1. 用 ~/Downloads/prototype(1)_副本.html (218KB) 创建项目, referenceHtml 直传
 *   2. 触发合成 → v1 应当通过 import-seed 短路, ≈ 源 bytes
 *   3. POST 一条带 【标注修改】 块的 Constraint must intent (改一个 button textContent)
 *   4. 触发合成 → v2 应当 ≈ v1 bytes (± 5%), 仅那个 button 改了
 *   5. 断言:
 *      - v2 bytes 在 v1 的 95-105% 之间 (允许 base64 / 空白微调)
 *      - v2 里 "Change plan" 减少 N, "Change Plan" 增加 N (N≥1)
 *      - keyframes 名字集合 v1 == v2 (没掉动画)
 *      - hiddenStates 数量 v1 ≈ v2 (没掉隐藏 tab)
 *      - v2 不含模板兼底标记 "Darwin 模板合成"
 *      - v2 不含偷懒占位注释 "existing.*preserved" / "rest omitted"
 *   6. 清理: DELETE 项目
 *
 * 用法:
 *   BASE=https://darwin.org.cn node tests/annotated-patch-e2e.mjs [round]
 *
 * 注: 测试依赖本地文件 ~/Downloads/prototype(1)_副本.html — CI 跑时需准备这个文件
 * 或者改成读 tests/fixtures/ 里的固定 HTML。当前为开发期测试。
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || process.env.E2E_BASE || 'https://darwin.org.cn';
const EMAIL = process.env.EMAIL || 'xuxin@deeplumen.com';
const FILE = process.env.FIXTURE || join(homedir(), 'Downloads', 'prototype(1)_副本.html');
const ROUND = process.argv[2] || '1';

let passed = 0, failed = 0;
const failures = [];

function ok(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; failures.push({ label, detail }); }
}

async function loginAs(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '123456' }),
  });
  const sc = r.headers.get('set-cookie') ?? '';
  const m = sc.match(/darwin_user_id=([^;]+)/);
  if (!m) throw new Error('login failed: no darwin_user_id cookie');
  return `darwin_user_id=${m[1]}`;
}

async function api(method, path, body, cookie) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, json };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function metricsOf(html) {
  const m = (re) => (html.match(re) || []).length;
  return {
    bytes: html.length,
    kfNames: [...html.matchAll(/@keyframes\s+([a-zA-Z_-][\w-]*)/g)].map(x => x[1]),
    hidden: m(/(?:display:\s*none|aria-hidden="true")/gi),
    headings: [1,2,3,4,5,6].reduce((a,i) => a + m(new RegExp(`<h${i}\\b`, 'gi')), 0),
    cpLower: (html.match(/Change plan/g) || []).length,
    cpProper: (html.match(/Change Plan/g) || []).length,
    templateFallback: html.includes('Darwin 模板合成'),
    lazyStubs: /existing[^<>]{0,30}preserved|rest[^<>]{0,30}omitted|rest of HTML/.test(html),
    runtimeScriptPatch: /button\.textContent\s*=\s*['"]Change Plan['"]/.test(html),
  };
}

async function main() {
  console.log(`\n═══ Annotated-Patch e2e — Round ${ROUND} ═══`);
  console.log(`BASE=${BASE}  FILE=${FILE}\n`);

  const sourceHtml = await readFile(FILE, 'utf8');
  const sourceMetrics = metricsOf(sourceHtml);
  console.log(`source: ${sourceMetrics.bytes}B  kf=${sourceMetrics.kfNames.length}  hidden=${sourceMetrics.hidden}  cp=${sourceMetrics.cpLower}/${sourceMetrics.cpProper}`);

  const cookie = await loginAs(EMAIL);

  let projectId = null;
  try {
    // 1. 建项目
    const proj = await api('POST', '/api/projects', {
      name: `AnnotPatch-E2E-${ROUND}-${Date.now()}`,
      type: 'html',
      conflictMode: 'discuss',
      referenceHtml: sourceHtml,
      referenceTitle: 'prototype.html',
      seedIntent: {
        statement: '请基于上传的 HTML 1:1 还原作为本项目起点; 后续意图增量调整。',
      },
    }, cookie);
    ok('create project', proj.status === 201 && proj.json?.project?.id);
    projectId = proj.json?.project?.id;
    if (!projectId) return;
    console.log(`  project=${projectId.slice(0, 8)}…`);

    // 2. 触发 v1 (import-seed 短路, 秒出)
    let t0 = Date.now();
    const v1 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
    ok('v1 synthesize 200', v1.status === 201 || v1.status === 200);
    const v1Content = v1.json?.version?.content || '';
    const v1Metrics = metricsOf(v1Content);
    console.log(`  v1: ${v1Metrics.bytes}B  in ${Math.round((Date.now() - t0) / 1000)}s  source=${v1.json?.source || v1.json?.version?.source}`);
    ok('v1 bytes ≈ source (≥90%)', v1Metrics.bytes >= sourceMetrics.bytes * 0.9);
    ok('v1 no template fallback', !v1Metrics.templateFallback);

    // 3. 提一条标注修改 intent — 改 "Change plan" → "Change Plan"
    const annIntent = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: `【标注修改】
1. [button · "Change plan" · in: "Almost there — confirm your subscription"] 改成 Change Plan`,
      type: 'Constraint', scope: 'global', weight: 'must',
    }, cookie);
    ok('annotation intent created', annIntent.status === 201 && annIntent.json?.intent?.id);

    // 4. 触发 v2 — 这次应当走 patch 路径
    t0 = Date.now();
    const v2 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
    ok('v2 synthesize 200', v2.status === 201 || v2.status === 200);
    const v2Content = v2.json?.version?.content || '';
    const v2Metrics = metricsOf(v2Content);
    const v2Source = v2.json?.source || v2.json?.version?.source || '?';
    console.log(`  v2: ${v2Metrics.bytes}B  in ${Math.round((Date.now() - t0) / 1000)}s  source=${v2Source}`);

    // 5. 关键断言
    ok('v2 used patch path (source=patch)', v2Source === 'patch',
       v2Source !== 'patch' ? `actual source=${v2Source}` : '');

    ok('v2 bytes ≈ v1 (within ±5%)',
       v2Metrics.bytes >= v1Metrics.bytes * 0.95 && v2Metrics.bytes <= v1Metrics.bytes * 1.05,
       `v2=${v2Metrics.bytes} v1=${v1Metrics.bytes} ratio=${(v2Metrics.bytes/v1Metrics.bytes).toFixed(3)}`);

    ok('v2 no template fallback marker', !v2Metrics.templateFallback);
    ok('v2 no "existing preserved" stubs', !v2Metrics.lazyStubs);
    ok('v2 no runtime-rename script', !v2Metrics.runtimeScriptPatch);

    // keyframes 完整
    const v1kf = new Set(v1Metrics.kfNames);
    const v2kf = new Set(v2Metrics.kfNames);
    const missingKf = [...v1kf].filter(n => !v2kf.has(n));
    ok(`@keyframes 完整 (v1=${v1kf.size}, v2=${v2kf.size}, 缺 ${missingKf.length})`, missingKf.length === 0,
       missingKf.length > 0 ? `missing: ${missingKf.slice(0, 5).join(',')}` : '');

    // hidden 区域基本完整 (±5)
    ok(`hidden states ≈ v1 (v1=${v1Metrics.hidden}, v2=${v2Metrics.hidden})`,
       Math.abs(v1Metrics.hidden - v2Metrics.hidden) <= 5);

    // headings 完整
    ok(`headings 完整 (v1=${v1Metrics.headings}, v2=${v2Metrics.headings})`,
       v1Metrics.headings === v2Metrics.headings);

    // Change plan / Change Plan 计数: 至少一处大小写改了
    const cpLowerDiff = v1Metrics.cpLower - v2Metrics.cpLower;
    const cpProperDiff = v2Metrics.cpProper - v1Metrics.cpProper;
    ok(`"Change plan" → "Change Plan" 至少改了 1 处 (lower -${cpLowerDiff}, proper +${cpProperDiff})`,
       cpLowerDiff >= 1 && cpProperDiff >= 1,
       `v1: cp_lower=${v1Metrics.cpLower}/cp_proper=${v1Metrics.cpProper} v2: cp_lower=${v2Metrics.cpLower}/cp_proper=${v2Metrics.cpProper}`);

  } finally {
    if (projectId) {
      const del = await api('DELETE', `/api/projects/${projectId}`, null, cookie);
      console.log(`  cleanup: DELETE ${projectId.slice(0, 8)} → ${del.status}`);
    }
  }

  console.log(`\nRound ${ROUND}: ${passed} passed, ${failed} failed`);
  if (failed > 0) for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('crashed:', err); process.exit(2); });
