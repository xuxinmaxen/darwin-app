/**
 * Annotated-patch mixed-mode e2e — 复现项目 8d72ef5a 触发整页缩水的实际场景:
 *   - intent #1: 短 selector + 简单文案替换 (button "Change plan" → "Change Plan")
 *   - intent #2: 容器级 selector + 新增内容指令 (#view-welcome-plan, 补 logo 图片)
 *
 * 旧行为: intent #2 让 LLM 拿到几十 KB 的 view 容器 outerHTML, 又因注解是"新增"而摘要式重写,
 *        全局 ratio fail → fall-through 到 LLM 全量 → 200KB 源页 → 22KB 缩水版 → 入库。
 * 新行为:
 *   - patch 内部对 intent #2 触发 elemRatio<0.5 → 单独跳过 (不替换那个 view)
 *   - intent #1 仍正常 apply → ratio 接近 1.0 → 走 patch 路径
 *   - 或者两个都被跳过 → 返回 existing 不变 (不 fall-through 到 LLM)
 * 关键不变量: v2 bytes 永远 ≈ v1 (导航 + 子页面不能消失)
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
    cpLower: (html.match(/Change plan/g) || []).length,
    cpProper: (html.match(/Change Plan/g) || []).length,
    viewWelcome: m(/id=["']view-welcome-plan["']/g),
    runtimeScriptPatch: /button\.textContent\s*=\s*['"]Change Plan['"]/.test(html),
  };
}

async function main() {
  console.log(`\n═══ Mixed-Mode Annotated-Patch e2e — Round ${ROUND} ═══`);
  console.log(`BASE=${BASE}\n`);

  const sourceHtml = await readFile(FILE, 'utf8');
  const cookie = await loginAs(EMAIL);

  let projectId = null;
  try {
    const proj = await api('POST', '/api/projects', {
      name: `Mixed-Patch-E2E-${ROUND}-${Date.now()}`,
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
    console.log(`  v1: ${v1Metrics.bytes}B  src=${v1.json?.source}  buttons=${v1Metrics.buttons} kf=${v1Metrics.kfNames.length} h=${v1Metrics.headings} viewWelcome=${v1Metrics.viewWelcome}`);

    // 复现用户实际提交的 2 条 intent
    const intentA = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: `【标注修改】\n1. [button · "Change plan"] 改成 Change Plan`,
      type: 'Constraint', scope: 'global', weight: 'must',
    }, cookie);
    ok('intent #1 (好 selector) created', intentA.status === 201);

    const intentB = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: `【标注修改】\n1. [#view-welcome-plan · "WELCOME TO DEEPLUMEN Your products, founded by AI Make every product, collection"] Real-time llms 切换时,里面的 Chatgpt 等 logo 图片没有加载出来,请补充`,
      type: 'Constraint', scope: 'global', weight: 'must',
    }, cookie);
    ok('intent #2 (容器级 + 新增内容) created', intentB.status === 201);

    const v2 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
    const v2Content = v2.json?.version?.content || '';
    const v2Metrics = metricsOf(v2Content);
    const v2Source = v2.json?.source || v2.json?.version?.source;
    console.log(`  v2: ${v2Metrics.bytes}B  src=${v2Source}  buttons=${v2Metrics.buttons} kf=${v2Metrics.kfNames.length} h=${v2Metrics.headings} viewWelcome=${v2Metrics.viewWelcome}  reason="${(v2.json?.reason || '').slice(0, 100)}"`);

    // 核心断言: v2 bytes 不能崩
    ok('v2 source=patch (never fall-through to LLM)', v2Source === 'patch',
       `actual source=${v2Source}`);
    ok('v2 bytes ≈ v1 (≥80%, 永不能崩到 22KB)',
       v2Metrics.bytes >= v1Metrics.bytes * 0.8,
       `v2=${v2Metrics.bytes} v1=${v1Metrics.bytes} ratio=${(v2Metrics.bytes/v1Metrics.bytes).toFixed(3)}`);
    ok('v2 keyframes 没掉', v2Metrics.kfNames.length >= v1Metrics.kfNames.length - 1);
    ok('v2 headings 没掉', v2Metrics.headings === v1Metrics.headings);
    ok('v2 view-welcome-plan 还在', v2Metrics.viewWelcome >= v1Metrics.viewWelcome);
    ok('v2 不含运行时 textContent 脚本', !v2Metrics.runtimeScriptPatch);

    // intent #1 应当成功 apply (button 文案改了, 至少 1 处)
    const cpLowerDiff = v1Metrics.cpLower - v2Metrics.cpLower;
    const cpProperDiff = v2Metrics.cpProper - v1Metrics.cpProper;
    ok(`intent #1 (好 selector) 至少 apply 了 1 处 (lower -${cpLowerDiff}, proper +${cpProperDiff})`,
       cpLowerDiff >= 1 && cpProperDiff >= 1);

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
