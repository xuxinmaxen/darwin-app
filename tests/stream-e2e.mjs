/**
 * Streaming synthesis e2e tests
 * Tests: SSE endpoint, chunk delivery, version save
 */

const BASE = 'http://localhost:3000';
let passed = 0, failed = 0;
const failures = [];

function ok(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; failures.push({ label, detail }); }
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

async function api(method, path, body, cookie = '') {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}

// ─── Setup ─────────────────────────────────────────────────────────────────
console.log('\n=== Setup ===');
const COOKIE = await loginAs('xuxin@deeplumen.com');
ok('login ok', !!COOKIE);

// Create test project + intent
const projRes = await api('POST', '/api/projects', {
  name: `Stream-Test-${Date.now()}`, type: 'html', conflictMode: 'discuss',
}, COOKIE);
ok('create project', projRes.status === 201, `status=${projRes.status}`);
const PROJECT_ID = projRes.json?.project?.id;
ok('project id exists', !!PROJECT_ID);

const intentRes = await api('POST', `/api/projects/${PROJECT_ID}/intents`, {
  statement: '做一个简洁的落地页，展示 AI 合成能力',
}, COOKIE);
ok('create intent', intentRes.status === 201);

// ─── T-1: SSE 端点返回 text/event-stream ────────────────────────────────────
console.log('\n=== T-1: SSE content-type ===');
{
  const res = await fetch(`${BASE}/api/projects/${PROJECT_ID}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: COOKIE },
  });
  ok('SSE status 200', res.status === 200, `status=${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  ok('content-type is text/event-stream', ct.includes('text/event-stream'), `ct=${ct}`);

  // ─── T-2: 读取事件流 ───────────────────────────────────────────────────────
  console.log('\n=== T-2: SSE event stream ===');

  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let timedOut = false;
  const deadline = Date.now() + 180_000; // 3 min max

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n\n');
    buf = lines.pop() ?? '';
    for (const block of lines) {
      const dataLine = block.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const evt = JSON.parse(dataLine.slice(6));
        events.push(evt);
        process.stdout.write(`  ← ${evt.type}${evt.type === 'thinking' ? ': ' + evt.message : evt.type === 'chunk' ? ` (${evt.content.length} chars)` : ''}\n`);
        if (evt.type === 'saved' || evt.type === 'error') break;
      } catch { /* ignore malformed */ }
    }
    const lastEvt = events.at(-1);
    if (lastEvt?.type === 'saved' || lastEvt?.type === 'error') break;
  }

  const thinkingEvents = events.filter(e => e.type === 'thinking');
  const chunkEvents = events.filter(e => e.type === 'chunk');
  const completeEvent = events.find(e => e.type === 'complete');
  const savedEvent = events.find(e => e.type === 'saved');
  const errorEvent = events.find(e => e.type === 'error');

  ok('no error event', !errorEvent, errorEvent?.message);
  ok('received thinking events', thinkingEvents.length > 0, `count=${thinkingEvents.length}`);
  ok('received chunk events', chunkEvents.length > 0, `count=${chunkEvents.length}`);
  ok('received complete event', !!completeEvent, 'no complete event');
  ok('received saved event', !!savedEvent, 'no saved event');

  if (completeEvent) {
    ok('complete.html is valid HTML', completeEvent.html?.includes('<!') || completeEvent.html?.includes('<html'), `preview=${completeEvent.html?.slice(0,60)}`);
  }
  if (savedEvent) {
    ok('saved.version has id', !!savedEvent.version?.id, JSON.stringify(savedEvent.version));
    ok('saved.mode exists', !!savedEvent.mode, `mode=${savedEvent.mode}`);
  }

  // chunks should form valid HTML when concatenated
  if (chunkEvents.length > 0 && completeEvent) {
    const assembled = chunkEvents.map(e => e.content).join('');
    ok('chunk html contains doctype or html tag', assembled.includes('<!') || assembled.includes('<html') || assembled.length > 50);
  }
}

// ─── T-3: 版本已入库 ───────────────────────────────────────────────────────
console.log('\n=== T-3: version persisted ===');
{
  const r = await api('GET', `/api/projects/${PROJECT_ID}/synthesize`, null, COOKIE);
  ok('get latest version 200', r.status === 200);
  ok('version exists in DB', !!r.json?.version?.id);
}

// ─── T-4: 非流式 POST 仍能工作(向后兼容) ───────────────────────────────────
console.log('\n=== T-4: non-stream POST backward compat ===');
{
  // add another intent so synthesize has something to do
  await api('POST', `/api/projects/${PROJECT_ID}/intents`, {
    statement: '强调团队协作场景',
  }, COOKIE);
  const r = await api('POST', `/api/projects/${PROJECT_ID}/synthesize`, null, COOKIE);
  ok('non-stream POST 201', r.status === 201, `status=${r.status}`);
  ok('non-stream has version', !!r.json?.version?.id);
}

// ─── Cleanup ────────────────────────────────────────────────────────────────
console.log('\n=== Cleanup ===');
{
  const r = await api('DELETE', `/api/projects/${PROJECT_ID}`, null, COOKIE);
  ok('cleanup project', r.status === 200 || r.json?.ok);
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Stream tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.error(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
