/**
 * Import HTML seed flow — 验证"导入即复刻蓝本, LLM 生成 v1"链路
 *
 * 设计 (2026-05-13 修订):
 *   早期版本是 "rawHtml 直接作为 v1 入库", 但用户反馈想要 AI 用自己的方式
 *   复刻一遍 (保证所有版本都过同一条合成路径)。因此现在的链路:
 *
 * 1. /api/import/html 返回 rawHtml + sanitize 应去掉 <script> / onXXX
 *    且注入 <base href> 让相对路径解析
 * 2. /api/projects POST 带 referenceHtml + referenceUrl/title + seedIntent 时:
 *    a. 项目创建成功
 *    b. 种子意图 (Reference scope=global) 入库
 *    c. project.background 含 【导入参考 (HTML)】 marker + 来源 + 压缩后 rawHtml
 *    d. 未自动写入 v1 — 由用户点"开始合成"触发 LLM
 * 3. referenceHtml 字段长度上限 (500KB)
 */

const BASE = 'http://localhost:3000';
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
  return m ? `darwin_user_id=${m[1]}` : '';
}

async function api(method, path, body, cookie) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}

console.log('\n=== Setup ===');
const COOKIE = await loginAs('xuxin@deeplumen.com');
ok('login ok', !!COOKIE);

// ─── 1. import-html: rawHtml + sanitize + base href ─────────
console.log('\n=== T-1: /api/import/html returns sanitized rawHtml ===');
{
  // 用 example.com (HTTP 200, 简单内容, 远端可用)
  const r = await api('POST', '/api/import/html', { url: 'https://example.com/' }, COOKIE);
  ok('import-html ok', r.status === 200 && r.json?.ok);
  ok('returns text preview', typeof r.json?.text === 'string' && r.json.text.length > 0);
  ok('returns rawHtml', typeof r.json?.rawHtml === 'string' && r.json.rawHtml.length > 0);
  ok('rawHtmlBytes reported', typeof r.json?.rawHtmlBytes === 'number');

  const rh = r.json?.rawHtml ?? '';
  ok('rawHtml has <base href> injected', /<base\s+href=/i.test(rh));
  ok('rawHtml has body content', /<body/i.test(rh));
  ok('rawHtml has <p> or <h1> tag (structure preserved)', /<(p|h1|h2|div)\b/i.test(rh));
}

// ─── 2. sanitize 防 XSS ────────────────────────────────────
console.log('\n=== T-2: sanitize strips <script> and on-handlers ===');
{
  // example.com 不会有 script,先用 httpbin 的 html endpoint 测一下 (返回 <h1>)
  // 我们没有受控 fixture, 直接 mock 用 data: URL 不行 (只接受 http/https)
  // 改为白盒检查: 调本地 helper 不可能,只能信任 import-html 的 sanitize 逻辑
  // 这里只做 smoke: rawHtml 中不应含 <script> 或 onclick=
  const r = await api('POST', '/api/import/html', { url: 'https://example.com/' }, COOKIE);
  const rh = r.json?.rawHtml ?? '';
  ok('rawHtml has no <script> tag', !/<script\b/i.test(rh));
  ok('rawHtml has no on-handlers', !/\son[a-z]+\s*=/i.test(rh));
  ok('rawHtml has no javascript: urls', !/javascript:/i.test(rh));
}

// ─── 3. 项目创建带 referenceHtml → 复刻蓝本进 background, 不自动建 v1 ──
console.log('\n=== T-3: create project with referenceHtml → background gets blueprint, no auto v1 ===');
let PROJECT_ID = null;
{
  const referenceHtml = `<!doctype html><html><head><base href="https://example.com/" target="_blank"><title>Cloned</title></head><body><h1>Hello from import</h1><p>This is the seeded HTML.</p></body></html>`;
  const createRes = await api('POST', '/api/projects', {
    name: `ImportRef-${Date.now()}`, type: 'html', conflictMode: 'discuss',
    seedIntent: { statement: '从 example.com 复刻本项目作为起点。' },
    referenceHtml,
    referenceUrl: 'https://example.com/',
    referenceTitle: 'Example Domain',
  }, COOKIE);
  ok('create project 201', createRes.status === 201);
  PROJECT_ID = createRes.json?.project?.id;
  ok('project id', !!PROJECT_ID);

  if (PROJECT_ID) {
    // 种子意图在
    const intentsRes = await api('GET', `/api/projects/${PROJECT_ID}/intents`, null, COOKIE);
    const intents = intentsRes.json?.intents ?? [];
    ok('seed intent persisted', intents.length === 1);

    // 关键: 不直接生成 v1 — 现在所有版本都由 LLM 在用户点"开始合成"时生成
    const synthRes = await api('GET', `/api/projects/${PROJECT_ID}/synthesize`, null, COOKIE);
    ok('no auto v1 saved (LLM must generate)', synthRes.json?.version === null,
       `expected null, got ${JSON.stringify(synthRes.json?.version)?.slice(0, 100)}`);

    // 项目 background 应含复刻蓝本 marker
    const projRes = await api('GET', `/api/projects`, null, COOKIE);
    const proj = (projRes.json?.projects ?? []).find(p => p.id === PROJECT_ID);
    ok('project background has 【导入参考 (HTML)】 marker',
       (proj?.background || '').includes('【导入参考 (HTML)】'));
    ok('project background carries source URL',
       (proj?.background || '').includes('example.com'));
    ok('project background carries condensed html',
       (proj?.background || '').includes('Hello from import'));

    // 验证版本数 = 0
    const versionsRes = await api('GET', `/api/projects/${PROJECT_ID}/versions`, null, COOKIE);
    ok('versions list empty (no auto v1)', (versionsRes.json?.versions ?? []).length === 0);
  }
}

// ─── 4. 不带 referenceHtml (blank 模式) — 不应该创建版本 ────
console.log('\n=== T-4: blank project (no referenceHtml) → no auto v1 ===');
{
  const createRes = await api('POST', '/api/projects', {
    name: `Blank-${Date.now()}`, type: 'html', conflictMode: 'discuss',
  }, COOKIE);
  const blankPid = createRes.json?.project?.id;
  ok('blank project created', !!blankPid);

  if (blankPid) {
    const synthRes = await api('GET', `/api/projects/${blankPid}/synthesize`, null, COOKIE);
    ok('no version for blank project', synthRes.json?.version === null);
    await api('DELETE', `/api/projects/${blankPid}`, null, COOKIE);
  }
}

// ─── 5. referenceHtml 长度上限 ─────────────────────────────
console.log('\n=== T-5: referenceHtml > 500KB → rejected by zod ===');
{
  const tooLarge = '<!doctype html><html><body>' + 'a'.repeat(500_500) + '</body></html>';
  const r = await api('POST', '/api/projects', {
    name: `TooBig-${Date.now()}`, type: 'html', conflictMode: 'discuss',
    referenceHtml: tooLarge,
  }, COOKIE);
  ok('500KB+ referenceHtml rejected', r.status === 400, `got status=${r.status}`);
}

// ─── Cleanup ───────────────────────────────────────────────
console.log('\n=== Cleanup ===');
if (PROJECT_ID) {
  await api('DELETE', `/api/projects/${PROJECT_ID}`, null, COOKIE);
  ok('cleanup test project', true);
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Import-seed tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.error(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
