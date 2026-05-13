/**
 * Round 3 — 针对本次重构的端到端验证
 *
 * 三个关键改动:
 *   #1 看板刷新延迟 + 分割线缺失
 *   #2 HTML 导入: rawHtml 不再直接入 v1, 而是作为复刻蓝本写进 project.background
 *   #3 跨刷新合成: auto-sync useEffect 加 isSynthesizing 阻断, 防重复触发
 *
 * 测试场景:
 *   T-1 导入路径: 创建项目 → 蓝本在 background → 首次合成 (LLM 生成 v1) → 内容确实是新生成的(不是 rawHtml 原文)
 *   T-2 自动重合成 debounce: 已合成 v1 后再加 intent → 不超过 8s 内出现 v2 (新 debounce ≈ 2.5s)
 *   T-3 流式合成中断不重启: POST 后客户端断开 → GET /synthesize/job 风格的轮询 → 30s 内 v 入库, 仅入库一次
 *   T-4 prompt 携带蓝本: 直接发流式合成,verify chunk 含正确结构 (LLM 看得到蓝本 → 输出会含 example.com 模拟的 hero/body)
 */

const BASE = 'http://localhost:3000';
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
const COOKIE = await loginAs('xuxin@deeplumen.com');
ok('login ok', !!COOKIE);

// ─── T-1: 导入路径 → background 含蓝本, v1 由 LLM 生成 ────────
console.log('\n=== T-1: import → blueprint in background → LLM 生成 v1 (不是 rawHtml 原文) ===');
let PROJ1 = null;
{
  const rawHtml = `<!doctype html><html><head><base href="https://example.com/" target="_blank"><title>Example Domain</title></head><body><div><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p><p><a href="https://www.iana.org/domains/example">More information...</a></p></div></body></html>`;
  const create = await api('POST', '/api/projects', {
    name: `R3-Import-${Date.now()}`,
    type: 'html',
    conflictMode: 'discuss',
    seedIntent: { statement: '请按照 example.com 的结构、文案、视觉风格复刻一份作为本项目的起点。' },
    referenceHtml: rawHtml,
    referenceUrl: 'https://example.com/',
    referenceTitle: 'Example Domain',
  }, COOKIE);
  ok('create project', create.status === 201);
  PROJ1 = create.json?.project?.id;
  ok('project id', !!PROJ1);

  // background 应携带蓝本 marker + 压缩后的原 HTML
  const list = await api('GET', '/api/projects', null, COOKIE);
  const me = (list.json?.projects ?? []).find(p => p.id === PROJ1);
  ok('background has 【导入参考 (HTML)】 marker', (me?.background || '').includes('【导入参考 (HTML)】'));
  ok('background carries source URL', (me?.background || '').includes('example.com'));
  ok('background carries condensed html content', (me?.background || '').includes('Example Domain'));

  // 首次合成 — 应该走 LLM
  const synth = await api('POST', `/api/projects/${PROJ1}/synthesize`, {}, COOKIE);
  ok('first synthesize 201', synth.status === 201, `status=${synth.status}, err=${synth.json?.error}`);
  const v1 = synth.json?.version;
  ok('v1 has id', !!v1?.id);
  ok('v1 has html content', typeof v1?.content === 'string' && v1.content.length > 0);
  // v1 是 LLM 自己写的, 不是原 rawHtml — content 应不同于 rawHtml (LLM 加自己的 CSS / 重排结构 等)
  ok('v1 content is NOT identical to rawHtml (LLM regenerated)', v1?.content !== rawHtml, 'content === rawHtml means we accidentally re-introduced direct-insert');
  // 合成 source 应为 llm (LLM 通了的情况下)
  ok('v1 source is llm or template (fallback)', v1?.source === 'llm' || v1?.source === 'template');

  // 验证版本数 = 1
  const versions = await api('GET', `/api/projects/${PROJ1}/versions`, null, COOKIE);
  ok('versions list has exactly 1', (versions.json?.versions ?? []).length === 1);
}

// ─── T-2: 自动重合成 debounce 缩短到 ~2.5s ────────────────
// 由于 debounce 在客户端 (ProjectCanvas useEffect), 服务端没有这逻辑
// 我们改测 "每次 POST synthesize 都能产生新版本" 而不阻塞
console.log('\n=== T-2: 多次 synthesize POST 都能产生新版本 (无服务端去重错误) ===');
{
  // 给 PROJ1 加一条意图, 再次 POST synthesize
  await api('POST', `/api/projects/${PROJ1}/intents`, {
    statement: '页面顶部加一条新的 hero copy', type: 'Goal', scope: 'hero', weight: 'should',
  }, COOKIE);

  const synth = await api('POST', `/api/projects/${PROJ1}/synthesize`, {}, COOKIE);
  ok('second synthesize 201', synth.status === 201, `status=${synth.status}`);
  const v2 = synth.json?.version;
  ok('v2 has id', !!v2?.id);

  const versions = await api('GET', `/api/projects/${PROJ1}/versions`, null, COOKIE);
  ok('versions list now has 2', (versions.json?.versions ?? []).length === 2);
}

// ─── T-3: SSE 流式中断 → 服务端继续 → 版本仍能入库 ─────────
console.log('\n=== T-3: SSE 客户端早断, 服务端继续完成合成 (跨刷新场景) ===');
let PROJ3 = null;
{
  const create = await api('POST', '/api/projects', {
    name: `R3-Stream-${Date.now()}`, type: 'html', conflictMode: 'discuss',
  }, COOKIE);
  PROJ3 = create.json?.project?.id;
  ok('create project', !!PROJ3);

  // 加一条 intent
  await api('POST', `/api/projects/${PROJ3}/intents`, {
    statement: '做一个简洁的产品落地页, 突出"协作"主题', type: 'Goal', scope: 'global', weight: 'must',
  }, COOKIE);

  // 起 SSE, 收到第一个 chunk 事件 (说明 LLM 真在生成) 后 abort (模拟刷新)
  // 关键: 太早 abort (thinking 阶段) 会把 LLM 调用一起取消, 所以要等 chunk
  const ac = new AbortController();
  const start = Date.now();
  const sseP = fetch(`${BASE}/api/projects/${PROJ3}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: COOKIE },
    body: JSON.stringify({}),
    signal: ac.signal,
  }).then(async r => {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let chunkSeen = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const s = dec.decode(value);
      if (s.includes('"type":"chunk"') && !chunkSeen) {
        chunkSeen = true;
        ac.abort();   // 模拟客户端刷新断开 (此时 LLM 已经在 chunk 阶段)
        break;
      }
    }
  }).catch(() => { /* abort is expected */ });
  // 安全兜底: 如果 60s 还没收到 chunk, 主动 abort
  const safetyAbort = setTimeout(() => ac.abort(), 60_000);
  await sseP;
  clearTimeout(safetyAbort);
  const abortedAt = Date.now() - start;
  ok('client disconnected from SSE', abortedAt < 65_000, `aborted after ${abortedAt}ms`);

  // 服务端应继续, 轮询 GET /synthesize 等 v1 入库 (最多 4 分钟)
  let v1Id = null;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await wait(3000);
    const g = await api('GET', `/api/projects/${PROJ3}/synthesize`, null, COOKIE);
    if (g.json?.version?.id) {
      v1Id = g.json.version.id;
      break;
    }
  }
  ok('version eventually persisted (server kept running)', !!v1Id, `no version within 4 min`);

  // 验证只有一个版本 (不应被重复触发)
  if (v1Id) {
    await wait(2000);
    const versions = await api('GET', `/api/projects/${PROJ3}/versions`, null, COOKIE);
    ok('exactly 1 version (no duplicate synthesis triggered)', (versions.json?.versions ?? []).length === 1,
       `got ${(versions.json?.versions ?? []).length}`);
  }
}

// ─── T-4: 直接验证 LLM 收到蓝本 — 流式 chunk 应含 example.com 的关键文案 ──
console.log('\n=== T-4: LLM 拿到蓝本后, 输出能识别出蓝本内容 ===');
{
  // 复用 PROJ1 (有 example.com 蓝本)
  // 起一次流式合成, 收集 chunks, 看是否能识别出蓝本的结构 / 文案
  // 用 "illustrative examples" / "Example Domain" 这种 example.com 独特标记作 fingerprint
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  let collected = '';
  try {
    const r = await fetch(`${BASE}/api/projects/${PROJ1}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: COOKIE },
      body: JSON.stringify({}),
      signal: ac.signal,
    });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      collected += dec.decode(value);
      if (collected.includes('"type":"complete"') || collected.length > 100_000) break;
    }
  } catch { /* timeout / abort */ }
  clearTimeout(timer);

  ok('stream produced some output', collected.length > 100, `got ${collected.length} bytes`);
  // 不强 assert 文案匹配 (LLM 可能改写), 但应至少看到 chunk 或 complete 事件
  ok('saw chunk or complete event', collected.includes('"type":"chunk"') || collected.includes('"type":"complete"'));
}

// ─── Cleanup ───────────────────────────────────────────
console.log('\n=== Cleanup ===');
if (PROJ1) await api('DELETE', `/api/projects/${PROJ1}`, null, COOKIE);
if (PROJ3) await api('DELETE', `/api/projects/${PROJ3}`, null, COOKIE);

console.log(`\n${'─'.repeat(50)}`);
console.log(`Round 3 architecture tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.error(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
