/**
 * Resume e2e — 验证「跨刷新合成接力」
 *
 * 1. POST /synthesize 开始流式合成
 * 2. SSE 一收到 chunk 立刻 abort (模拟刷新)
 * 3. 立刻 GET /synthesize/job → 应看到 running=true + partial_html 不为空
 * 4. 隔几秒再 GET /job → partial_html 应增长 (服务端 chunk 还在进)
 * 5. 等服务端跑完 → GET /job 应看到 running=false + phase=done
 * 6. GET /synthesize → 拿到新 version
 * 7. 确认整张表里只有 1 个新 version (没有重复合成)
 */

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
let passed = 0, failed = 0;
const failures = [];

function ok(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; failures.push({ label, detail }); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

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
const COOKIE = await loginAs('xuxinmaxen@deeplumen.com').catch(() => '') || await loginAs('xuxin@deeplumen.com');
ok('login ok', !!COOKIE);

// 起项目 + 一条 intent
const create = await api('POST', '/api/projects', {
  name: `Resume-${Date.now()}`, type: 'html', conflictMode: 'discuss',
}, COOKIE);
const PID = create.json?.project?.id;
ok('create project', !!PID);

await api('POST', `/api/projects/${PID}/intents`, {
  statement: '一个简洁现代的产品落地页, 强调"AI 协作"主题', type: 'Goal', scope: 'global', weight: 'must',
}, COOKIE);

// 起 SSE → 第一个 chunk 后 abort
console.log('\n=== T-1: 早断 SSE, 服务端继续, /job 拿到 partial ===');
let abortedAt = 0;
{
  const ac = new AbortController();
  const t0 = Date.now();
  const sseP = fetch(`${BASE}/api/projects/${PID}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: COOKIE },
    body: JSON.stringify({}),
    signal: ac.signal,
  }).then(async r => {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const s = dec.decode(value);
      if (s.includes('"type":"chunk"')) {
        ac.abort();
        break;
      }
    }
  }).catch(() => {});
  // safety: 90s 还没 chunk 也 abort
  const safety = setTimeout(() => ac.abort(), 90_000);
  await sseP;
  clearTimeout(safety);
  abortedAt = Date.now() - t0;
  ok('SSE aborted after first chunk', abortedAt < 95_000, `aborted at ${abortedAt}ms`);
}

// 立刻 GET /job → 应 running=true + partial_html 不空
console.log('\n=== T-2: 立刻 GET /job 拿到 running 快照 ===');
let firstPartialLen = 0;
{
  const r = await api('GET', `/api/projects/${PID}/synthesize/job`, null, COOKIE);
  ok('/job 200', r.status === 200);
  const job = r.json?.job;
  ok('job.running true', job?.running === true, `running=${job?.running}`);
  ok('job.phase in [starting,streaming]', ['starting', 'streaming'].includes(job?.phase), `phase=${job?.phase}`);
  firstPartialLen = (job?.partialHtml || '').length;
  // 注意: partialHtml 可能是 null (服务端还没 flush 第一次), 不强 assert > 0
  console.log(`    partialHtml.length = ${firstPartialLen}`);
}

// 等 4 秒, 再 GET → partial 应已增长 或 已完成
console.log('\n=== T-3: 4s 后 GET /job 看 partial 增长 (或已完成) ===');
{
  await wait(4000);
  const r = await api('GET', `/api/projects/${PID}/synthesize/job`, null, COOKIE);
  const job = r.json?.job;
  const newLen = (job?.partialHtml || '').length;
  console.log(`    partialHtml.length now = ${newLen}, running=${job?.running}, phase=${job?.phase}`);
  ok('partial grew or job finished',
     newLen > firstPartialLen || job?.running === false,
     `firstLen=${firstPartialLen} newLen=${newLen} running=${job?.running}`);
}

// 轮询到 running=false (≤ 4min)
console.log('\n=== T-4: 等服务端跑完 ===');
let finalJob = null;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  await wait(2000);
  const r = await api('GET', `/api/projects/${PID}/synthesize/job`, null, COOKIE);
  if (r.json?.job && r.json.job.running === false) {
    finalJob = r.json.job;
    break;
  }
}
ok('job 最终 running=false', !!finalJob, finalJob ? `phase=${finalJob.phase}` : 'timeout');

if (finalJob) {
  ok('job.phase = done', finalJob.phase === 'done', `got ${finalJob.phase} err=${finalJob.error}`);
  ok('job.partialHtml 已清空', finalJob.partialHtml === null || finalJob.partialHtml === '',
     `len=${(finalJob.partialHtml||'').length}`);
}

// GET /synthesize → 拿到新 version
console.log('\n=== T-5: GET /synthesize 拿到最终版本 ===');
{
  const r = await api('GET', `/api/projects/${PID}/synthesize`, null, COOKIE);
  ok('latest version exists', !!r.json?.version?.id);
  ok('version content non-empty', (r.json?.version?.content || '').length > 100);
}

// 确认只有 1 个 version
console.log('\n=== T-6: 没有重复合成 ===');
{
  const r = await api('GET', `/api/projects/${PID}/versions`, null, COOKIE);
  ok('exactly 1 version', (r.json?.versions ?? []).length === 1, `got ${(r.json?.versions ?? []).length}`);
}

// Cleanup
console.log('\n=== Cleanup ===');
await api('DELETE', `/api/projects/${PID}`, null, COOKIE);

console.log(`\n${'─'.repeat(50)}`);
console.log(`Resume e2e: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.error(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
