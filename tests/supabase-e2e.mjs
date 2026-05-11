/**
 * Darwin Supabase E2E Test Suite
 * Tests all critical API flows against the live Supabase-backed dev server.
 *
 * Run: node tests/supabase-e2e.mjs
 */

const BASE = 'http://localhost:3000';
const DEMO_OWNER = '00000000-0000-0000-0000-000000000001';
let passed = 0, failed = 0;
const failures = [];

async function api(method, path, body, cookieHeader = '') {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json, headers: res.headers };
}

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
    failures.push({ label, detail });
  }
}

// ─── Helper: login and get cookie ─────────────────────────────────────────────
async function loginAs(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '123456' }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/darwin_user_id=([^;]+)/);
  const cookie = match ? `darwin_user_id=${match[1]}` : '';
  return cookie;
}

// ─── T-1: Health + Auth ───────────────────────────────────────────────────────
console.log('\n=== T-1: Health & Auth ===');
{
  const { json } = await api('GET', '/api/health');
  ok('health ok', json.ok === true);
  ok('supabase connected', json.env?.supabase === true);
  ok('LLM provider configured', !!json.llm?.provider);
}
{
  const { status, json } = await api('POST', '/api/auth/login', { email: 'xuxin@deeplumen.com', code: '123456' });
  ok('login with valid creds → 200', status === 200, `status=${status}`);
  ok('login returns user', !!json.user?.id);
  ok('login user name correct', json.user?.name === '徐鑫', `got=${json.user?.name}`);
}
{
  const { status } = await api('POST', '/api/auth/login', { email: 'xuxin@deeplumen.com', code: '000000' });
  ok('wrong code → 401', status === 401, `status=${status}`);
}
{
  const { status } = await api('POST', '/api/auth/login', { email: 'nobody@test.com', code: '123456' });
  ok('unknown email → 404', status === 404, `status=${status}`);
}

const adminCookie = await loginAs('xuxin@deeplumen.com');
ok('login returns cookie', !!adminCookie, adminCookie);

// ─── T-2: Employees ───────────────────────────────────────────────────────────
console.log('\n=== T-2: Employees ===');
let testEmpId = '';
{
  const { status, json } = await api('GET', '/api/employees', null, adminCookie);
  ok('list employees → 200', status === 200, `status=${status}`);
  ok('employees array exists', Array.isArray(json.employees));
  ok('seed employee exists', json.employees?.some(e => e.email === 'xuxin@deeplumen.com'));
}
{
  const { status, json } = await api('POST', '/api/employees', {
    kind: 'human', name: 'E2E TestUser', role: 'QA', email: `e2e.${Date.now()}@test.com`,
  }, adminCookie);
  ok('create employee → 201', status === 201, `status=${status}, err=${json.error}`);
  testEmpId = json.employee?.id ?? '';
  ok('employee id returned', !!testEmpId);
  ok('employee name correct', json.employee?.name === 'E2E TestUser');
}
{
  const { status, json } = await api('PATCH', `/api/employees/${testEmpId}`, { role: 'RD' }, adminCookie);
  ok('update employee → 200', status === 200, `status=${status}`);
  ok('role updated', json.employee?.role === 'RD');
}

// ─── T-3: Projects CRUD ───────────────────────────────────────────────────────
console.log('\n=== T-3: Projects CRUD ===');
let testProjectId = '';
{
  const { status, json } = await api('POST', '/api/projects', {
    name: `E2E Project ${Date.now()}`, type: 'html',
    background: 'E2E test project for automated testing',
  }, adminCookie);
  ok('create project → 201', status === 201, `status=${status}, err=${json.error}`);
  testProjectId = json.project?.id ?? '';
  ok('project id returned', !!testProjectId);
  ok('project type html', json.project?.type === 'html');
  ok('project status draft', json.project?.status === 'draft');
}
{
  const { status, json } = await api('GET', `/api/projects/${testProjectId}`, null, adminCookie);
  ok('get project → 200', status === 200, `status=${status}`);
  ok('project name matches', json.project?.name?.startsWith('E2E Project'));
}
{
  const { status, json } = await api('PATCH', `/api/projects/${testProjectId}`, {
    background: 'Updated background',
  }, adminCookie);
  ok('update project → 200', status === 200, `status=${status}`);
  ok('background updated', json.project?.background === 'Updated background');
}

// ─── T-4: Intents ─────────────────────────────────────────────────────────────
console.log('\n=== T-4: Intents ===');
let testIntentId = '';
{
  const { status, json } = await api('POST', `/api/projects/${testProjectId}/intents`, {
    statement: '要让首页有强烈的视觉冲击力',
  }, adminCookie);
  ok('create intent → 201', status === 201, `status=${status}, err=${json.error}`);
  testIntentId = json.intent?.id ?? '';
  ok('intent id returned', !!testIntentId);
  ok('intent statement stored', json.intent?.statement === '要让首页有强烈的视觉冲击力');
  ok('extract source is llm or default', ['llm', 'default'].includes(json.extractSource ?? ''));
}
{
  const { status, json } = await api('GET', `/api/projects/${testProjectId}/intents`, null, adminCookie);
  ok('list intents → 200', status === 200, `status=${status}`);
  ok('intents array has our intent', json.intents?.some(i => i.id === testIntentId));
}

// Second intent for tension testing
let intent2Id = '';
{
  const { status, json } = await api('POST', `/api/projects/${testProjectId}/intents`, {
    statement: '首页要极简克制,不要视觉干扰',
    type: 'Goal', scope: 'hero', weight: 'must',
  }, adminCookie);
  ok('create 2nd intent → 201', status === 201, `status=${status}`);
  intent2Id = json.intent?.id ?? '';
}

// ─── T-5: Versions & Synthesize ───────────────────────────────────────────────
console.log('\n=== T-5: Versions ===');
{
  const { status, json } = await api('GET', `/api/projects/${testProjectId}/synthesize`, null, adminCookie);
  ok('synthesize endpoint reachable → 200|202', [200, 202].includes(status), `status=${status}, err=${json.error}`);
}
{
  const { status, json } = await api('GET', `/api/projects/${testProjectId}/versions`, null, adminCookie);
  ok('list versions → 200', status === 200, `status=${status}`);
  ok('versions is array', Array.isArray(json.versions));
}

// ─── T-6: Tensions ────────────────────────────────────────────────────────────
console.log('\n=== T-6: Tensions ===');
{
  const { status, json } = await api('GET', `/api/projects/${testProjectId}/tensions`, null, adminCookie);
  ok('list tensions → 200', status === 200, `status=${status}`);
  ok('tensions array', Array.isArray(json.tensions));
}

// ─── T-7: Threads ─────────────────────────────────────────────────────────────
console.log('\n=== T-7: Threads ===');
let testThreadId = '';
{
  const { status, json } = await api('POST', `/api/projects/${testProjectId}/threads`, {
    scope: 'hero', title: 'E2E 讨论',
    openingMessages: [{ authorId: DEMO_OWNER, authorKind: 'system', body: '这是一个测试讨论。' }],
  }, adminCookie);
  ok('create thread → 201', status === 201, `status=${status}, err=${json.error}`);
  testThreadId = json.thread?.id ?? '';
  ok('thread id returned', !!testThreadId);
}
{
  const { status, json } = await api('POST', `/api/threads/${testThreadId}/messages`, {
    body: '我觉得首页应该更大胆一点',
    authorId: DEMO_OWNER, authorKind: 'human',
  }, adminCookie);
  ok('post message → 201', status === 201, `status=${status}, err=${json.error}`);
  ok('message body correct', json.message?.body === '我觉得首页应该更大胆一点');
}
{
  const { status, json } = await api('GET', `/api/threads/${testThreadId}/messages`, null, adminCookie);
  ok('list messages → 200', status === 200, `status=${status}`);
  ok('2 messages (opening + human)', (json.messages?.length ?? 0) >= 2, `count=${json.messages?.length}`);
}
{
  // Resolve thread
  const { status } = await api('PATCH', `/api/threads/${testThreadId}`, { status: 'resolved' }, adminCookie);
  ok('resolve thread → 200', status === 200, `status=${status}`);
}
{
  // Can't post to resolved thread
  const { status } = await api('POST', `/api/threads/${testThreadId}/messages`, {
    body: 'late message', authorId: DEMO_OWNER, authorKind: 'human',
  }, adminCookie);
  ok('post to resolved thread → 409', status === 409, `status=${status}`);
}

// ─── T-8: Team Memory ─────────────────────────────────────────────────────────
console.log('\n=== T-8: Team Memory ===');
let testPrefId = '';
{
  const { status, json } = await api('GET', '/api/team/memory', null, adminCookie);
  ok('memory page → 200', status === 200, `status=${status}`);
  ok('has prefs array', Array.isArray(json.prefs));
  ok('has agents array', Array.isArray(json.agents));
}
{
  const { status, json } = await api('POST', '/api/team/prefs', {
    iconKey: 'pen', category: 'E2E测试', body: 'E2E test preference',
    source: 'E2E测试', sourceCls: 'xu',
  }, adminCookie);
  ok('create pref → 201', status === 201, `status=${status}, err=${json.error}`);
  testPrefId = json.pref?.id ?? '';
  ok('pref id returned', !!testPrefId);
}
{
  const { status } = await api('DELETE', `/api/team/prefs/${testPrefId}`, null, adminCookie);
  ok('delete pref → 200', status === 200, `status=${status}`);
}

// ─── T-9: Auth logout ─────────────────────────────────────────────────────────
console.log('\n=== T-9: Auth Logout ===');
{
  const { status, json } = await api('POST', '/api/auth/logout', null, adminCookie);
  ok('logout → 200', status === 200, `status=${status}`);
  ok('logout ok', json.ok === true);
}

// ─── T-10: Intent deletion ────────────────────────────────────────────────────
console.log('\n=== T-10: Intent Deletion ===');
{
  const freshCookie = await loginAs('xuxin@deeplumen.com');
  const { status, json } = await api('DELETE', `/api/intents/${testIntentId}`, null, freshCookie);
  ok('delete intent → 200', status === 200, `status=${status}, err=${json.error}`);
}

// ─── T-11: Project deletion (cleanup) ────────────────────────────────────────
console.log('\n=== T-11: Cleanup ===');
{
  const freshCookie = await loginAs('xuxin@deeplumen.com');
  const { status } = await api('DELETE', `/api/projects/${testProjectId}`, null, freshCookie);
  ok('delete project → 200', status === 200, `status=${status}`);
}
{
  if (testEmpId) {
    const freshCookie = await loginAs('xuxin@deeplumen.com');
    const { status } = await api('DELETE', `/api/employees/${testEmpId}`, null, freshCookie);
    ok('delete test employee → 200', status === 200, `status=${status}`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) console.log(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
