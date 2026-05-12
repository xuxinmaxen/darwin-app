/**
 * Heartbeat & real online status tests
 */

const BASE = 'http://localhost:3000';
let passed = 0, failed = 0;
const failures = [];

async function api(method, path, body, cookie = '') {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json, headers: res.headers };
}
function ok(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; failures.push({ label, detail }); }
}
async function loginAs(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '123456' }),
  });
  const sc = res.headers.get('set-cookie') ?? '';
  const m = sc.match(/darwin_user_id=([^;]+)/);
  return m ? `darwin_user_id=${m[1]}` : '';
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// ─── T-1: Heartbeat endpoint ──────────────────────────────────────────────
console.log('\n=== T-1: Heartbeat endpoint ===');
{
  // No cookie → 401
  const r = await api('POST', '/api/auth/heartbeat');
  ok('heartbeat without cookie → 401', r.status === 401, `status=${r.status}`);
}

const COOKIE = await loginAs('xuxin@deeplumen.com');
ok('login ok', !!COOKIE);

{
  // With cookie → 200
  const r = await api('POST', '/api/auth/heartbeat', null, COOKIE);
  ok('heartbeat with cookie → 200', r.status === 200, `status=${r.status}`);
  ok('heartbeat returns ok', r.json.ok === true);
}

// ─── T-2: Login sets user online ─────────────────────────────────────────
console.log('\n=== T-2: Login → online status ===');
{
  // After login + heartbeat, the user should be marked as online
  await api('POST', '/api/auth/heartbeat', null, COOKIE);
  await wait(500); // give DB a moment
  const r = await api('GET', '/api/employees', null, COOKIE);
  const me = r.json.employees?.find(e => e.email === 'xuxin@deeplumen.com');
  ok('me is online after login+heartbeat', me?.isOnline === true, `isOnline=${me?.isOnline}`);
}

// ─── T-3: Agent is always online ─────────────────────────────────────────
console.log('\n=== T-3: Agent always online ===');
{
  // Create a test agent
  const r = await api('POST', '/api/employees', {
    kind: 'agent', name: 'HB-Test Agent', role: 'QA',
    persona: '在线状态测试 Agent',
  }, COOKIE);
  ok('create agent', r.status === 201);
  const agentId = r.json?.employee?.id;
  if (agentId) {
    const r2 = await api('GET', '/api/employees', null, COOKIE);
    const agent = r2.json.employees?.find(e => e.id === agentId);
    ok('agent isOnline = true', agent?.isOnline === true, `isOnline=${agent?.isOnline}`);
    // cleanup
    await api('DELETE', `/api/employees/${agentId}`, null, COOKIE);
  }
}

// ─── T-4: Logout clears online status ────────────────────────────────────
console.log('\n=== T-4: Logout → offline ===');
{
  // Create a second human user, login as them, then logout, check status
  const r = await api('POST', '/api/employees', {
    kind: 'human', name: 'HB-Test User', role: 'QA',
    email: `hb.${Date.now()}@test.com`,
  }, COOKIE);
  ok('create test user', r.status === 201);
  const testEmail = r.json?.employee?.email;
  const testId = r.json?.employee?.id;

  if (testEmail && testId) {
    const testCookie = await loginAs(testEmail);
    ok('test user logged in', !!testCookie);
    await wait(500);

    // After login should be online
    const r1 = await api('GET', '/api/employees', null, COOKIE);
    const u1 = r1.json.employees?.find(e => e.id === testId);
    ok('test user is online after login', u1?.isOnline === true, `isOnline=${u1?.isOnline}`);

    // Logout
    await api('POST', '/api/auth/logout', null, testCookie);
    await wait(500);

    const r2 = await api('GET', '/api/employees', null, COOKIE);
    const u2 = r2.json.employees?.find(e => e.id === testId);
    ok('test user is offline after logout', u2?.isOnline === false, `isOnline=${u2?.isOnline}`);

    // cleanup
    await api('DELETE', `/api/employees/${testId}`, null, COOKIE);
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Heartbeat tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
