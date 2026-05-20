/**
 * Free-text intent surgical-edit e2e — 复现 8d72ef5a 项目 4c8fa1d3 (177B 占位 stub) 回归:
 *   - v1: prototype.html 1:1 还原 (200KB)
 *   - 用户提一条"自由文本" intent (非 【标注修改】): "右侧展示图片中 chatgpt 等 logo 都糊了, 补充正确的 logo"
 *   - 旧行为: LLM 增量路径输出 177B 占位 stub → looksLikeCompleteHtml 通过 → 写库 → 整页崩塌
 *   - 新行为: synthesize.ts checkIncrementalOutput 兜底 → 保留 existing 不变, 不允许 LLM 删别的模块
 *
 * 关键不变量:
 *   - v2 bytes 在 v1 的 80%-120% 区间 (其他模块不能因为单条 intent 被删)
 *   - v2 不含 "patch not applied" / "budget exceeded" / "existing HTML preserved" 这类占位文本
 *   - v2 仍含 v1 的全部 view-* 子页面 (nav 和子页面不消失)
 *   - v2 keyframes / headings / buttons 基本不掉
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'https://darwin.org.cn';
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
  const m = r.headers.get('set-cookie')?.match(/darwin_user_id=([^;]+)/);
  if (!m) throw new Error('login failed');
  return `darwin_user_id=${m[1]}`;
}

async function api(method, path, body, cookie) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, json };
}

function metricsOf(html) {
  const m = (re) => (html.match(re) || []).length;
  return {
    bytes: html.length,
    kfNames: [...html.matchAll(/@keyframes\s+([a-zA-Z_-][\w-]*)/g)].map(x => x[1]),
    hidden: m(/(?:display:\s*none|aria-hidden="true")/gi),
    headings: [1,2,3,4,5,6].reduce((a,i) => a + m(new RegExp(`<h${i}\\b`, 'gi')), 0),
    buttons: m(/<button\b/gi),
    viewNodes: m(/id=["']view-[^"']+["']/g),
    placeholders: /patch not applied|budget exceeded|existing HTML preserved|rest of HTML omitted|<!-- *unchanged *-->/i.test(html),
  };
}

async function main() {
  console.log(`\n═══ Free-text Intent Surgical-Edit e2e — Round ${ROUND} ═══`);
  console.log(`BASE=${BASE}\n`);

  const sourceHtml = await readFile(FILE, 'utf8');
  const cookie = await loginAs(EMAIL);

  let projectId = null;
  try {
    const proj = await api('POST', '/api/projects', {
      name: `Freetext-Surgical-E2E-${ROUND}-${Date.now()}`,
      type: 'html',
      conflictMode: 'discuss',
      referenceHtml: sourceHtml,
      referenceTitle: 'prototype.html',
      seedIntent: { statement: '请基于上传的 HTML 1:1 还原作为本项目起点; 后续意图增量调整。' },
    }, cookie);
    ok('create project', proj.status === 201 && proj.json?.project?.id);
    projectId = proj.json?.project?.id;
    if (!projectId) return;

    const v1 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
    const v1Content = v1.json?.version?.content || '';
    const v1Metrics = metricsOf(v1Content);
    console.log(`  v1: ${v1Metrics.bytes}B  src=${v1.json?.source}  buttons=${v1Metrics.buttons} kf=${v1Metrics.kfNames.length} h=${v1Metrics.headings} views=${v1Metrics.viewNodes}`);
    ok('v1 bytes ≥ 50KB (real source)', v1Metrics.bytes >= 50_000);

    // 复现用户实际提交的"自由文本" intent — scope 可能被 AI 抽到细粒度 (real-time-llms.right_image 等)
    const intent = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: 'real-time-llms.txt 右侧展示图片中,chatgpt、claude、gemini、perplexity 的 logo 都糊了,请补充正确的 logo',
      type: 'Constraint', scope: 'global', weight: 'must',
    }, cookie);
    ok('free-text intent created', intent.status === 201);

    const v2 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
    const v2Content = v2.json?.version?.content || '';
    const v2Metrics = metricsOf(v2Content);
    const v2Source = v2.json?.source || v2.json?.version?.source;
    const v2Reason = (v2.json?.reason || v2.json?.version?.reason || '').slice(0, 120);
    console.log(`  v2: ${v2Metrics.bytes}B  src=${v2Source}  buttons=${v2Metrics.buttons} kf=${v2Metrics.kfNames.length} h=${v2Metrics.headings} views=${v2Metrics.viewNodes}  reason="${v2Reason}"`);

    // 关键断言: v2 bytes 必须在 v1 的 80%-120% 区间
    const ratio = v2Metrics.bytes / v1Metrics.bytes;
    ok(`v2 bytes 在 v1 的 80%-120% 区间 (实际 ${(ratio * 100).toFixed(0)}%)`,
       ratio >= 0.8 && ratio <= 1.2,
       `v2=${v2Metrics.bytes} v1=${v1Metrics.bytes}`);

    ok('v2 不含占位 stub 文本', !v2Metrics.placeholders);
    ok('v2 view-* 子页面没掉', v2Metrics.viewNodes >= v1Metrics.viewNodes,
       `v2.viewNodes=${v2Metrics.viewNodes} v1.viewNodes=${v1Metrics.viewNodes}`);
    ok('v2 keyframes 没掉', v2Metrics.kfNames.length >= v1Metrics.kfNames.length - 1);
    ok('v2 headings 没掉', v2Metrics.headings >= v1Metrics.headings - 2,
       `v2.h=${v2Metrics.headings} v1.h=${v1Metrics.headings}`);
    ok('v2 buttons 没掉一大半', v2Metrics.buttons >= v1Metrics.buttons * 0.6,
       `v2.btns=${v2Metrics.buttons} v1.btns=${v1Metrics.buttons}`);

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
