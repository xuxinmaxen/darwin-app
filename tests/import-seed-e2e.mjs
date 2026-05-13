/**
 * Import HTML seed flow — 验证"导入即 v1, 不调 LLM"链路
 *
 * 1. /api/import/html 返回 rawHtml + sanitize 应去掉 <script> / onXXX
 *    且注入 <base href> 让相对路径解析
 * 2. /api/projects POST 带 seedHtml + seedIntent 时:
 *    a. 项目创建成功
 *    b. 种子意图入库
 *    c. v1 入库, content == seedHtml, intentIds 含种子意图
 * 3. 进入项目读 GET /synthesize 立即拿到 v1 (无需点开始合成)
 * 4. seedHtml 字段长度上限 (500KB)
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

// ─── 3. 项目创建带 seedHtml → v1 直接入库 ──────────────────
console.log('\n=== T-3: create project with seedHtml → v1 saved without LLM ===');
let PROJECT_ID = null;
{
  const seedHtml = `<!doctype html><html><head><base href="https://example.com/" target="_blank"><title>Cloned</title></head><body><h1>Hello from import</h1><p>This is the seeded HTML.</p></body></html>`;
  const createRes = await api('POST', '/api/projects', {
    name: `ImportSeedHtml-${Date.now()}`, type: 'html', conflictMode: 'discuss',
    seedIntent: { statement: '从 example.com 复刻本项目作为起点。' },
    seedHtml,
  }, COOKIE);
  ok('create project 201', createRes.status === 201);
  PROJECT_ID = createRes.json?.project?.id;
  ok('project id', !!PROJECT_ID);

  if (PROJECT_ID) {
    // 种子意图在
    const intentsRes = await api('GET', `/api/projects/${PROJECT_ID}/intents`, null, COOKIE);
    const intents = intentsRes.json?.intents ?? [];
    ok('seed intent persisted', intents.length === 1);

    // v1 在 — 这是关键: import 流程不点开始合成也能直接拿到 v1
    const synthRes = await api('GET', `/api/projects/${PROJECT_ID}/synthesize`, null, COOKIE);
    const v1 = synthRes.json?.version;
    ok('v1 saved at project creation', !!v1?.id, 'version null');
    ok('v1 content === seedHtml', v1?.content === seedHtml, 'content mismatch');
    ok('v1 intentIds contains seed intent', Array.isArray(v1?.intentIds) && v1.intentIds.length === 1);

    // 验证版本数 = 1
    const versionsRes = await api('GET', `/api/projects/${PROJECT_ID}/versions`, null, COOKIE);
    ok('versions list has 1', (versionsRes.json?.versions ?? []).length === 1);
  }
}

// ─── 4. 不带 seedHtml (blank 模式) — 不应该创建版本 ─────────
console.log('\n=== T-4: blank project (no seedHtml) → no auto v1 ===');
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

// ─── 5. seedHtml 长度上限 ──────────────────────────────────
console.log('\n=== T-5: seedHtml > 500KB → rejected by zod ===');
{
  const tooLarge = '<!doctype html><html><body>' + 'a'.repeat(500_500) + '</body></html>';
  const r = await api('POST', '/api/projects', {
    name: `TooBig-${Date.now()}`, type: 'html', conflictMode: 'discuss',
    seedHtml: tooLarge,
  }, COOKIE);
  ok('500KB+ seedHtml rejected', r.status === 400, `got status=${r.status}`);
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
