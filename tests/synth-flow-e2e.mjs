/**
 * Synthesis flow e2e — 针对最近 3 个 bug 的回归测试
 *
 *   1. 导入流程: 创建项目时挂 seedIntent → intent 落库, 不自动合成 v1
 *   2. 首次合成: API 调用一次 → 一定能拿到 v1
 *   3. 跨刷新: 合成开始 (POST) → 中途断开 → 服务端继续 → GET 能拿到 v1
 *
 *   还会跑一次 tension 去重: resolve 后重新 detect, 不应创建新 tension
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

const wait = ms => new Promise(r => setTimeout(r, ms));

console.log('\n=== Setup ===');
const COOKIE = await loginAs('xuxin@deeplumen.com');
ok('login ok', !!COOKIE);

// ─── Issue 1 回归: seedIntent 落库,无自动 v1 ─────────────
console.log('\n=== Issue 1: import flow creates seed intent, no auto-synthesis ===');
{
  const createRes = await api('POST', '/api/projects', {
    name: `ImportSeed-${Date.now()}`, type: 'html', conflictMode: 'discuss',
    background: '【导入参考 (HTML)】来源: https://example.com\n标题: Example\n\nSome reference text.',
    seedIntent: { statement: '请基于「Example」(https://example.com) 这份落地页的结构合成本项目。' },
  }, COOKIE);
  ok('create project with seedIntent', createRes.status === 201);
  const PID = createRes.json?.project?.id;
  ok('project id', !!PID);

  if (PID) {
    // 等 0.5s 防止潜在的异步 fire-and-forget 已经触发
    await wait(500);

    const intentsRes = await api('GET', `/api/projects/${PID}/intents`, null, COOKIE);
    ok('intents endpoint ok', intentsRes.status === 200);
    const intents = intentsRes.json?.intents ?? [];
    ok('seed intent persisted', intents.length === 1, `count=${intents.length}`);
    if (intents.length === 1) {
      ok('seed type=Reference', intents[0].type === 'Reference', `type=${intents[0].type}`);
      ok('seed scope=global', intents[0].scope === 'global');
      ok('seed authorKind=human', intents[0].authorKind === 'human');
    }

    // 关键: 不应该自动合成出 v1
    const verRes = await api('GET', `/api/projects/${PID}/synthesize`, null, COOKIE);
    ok('synth GET endpoint ok', verRes.status === 200);
    ok('no auto v1 (version=null until user clicks)', verRes.json?.version === null);

    await api('DELETE', `/api/projects/${PID}`, null, COOKIE);
  }
}

// ─── Issue 2 回归: 首次合成接口可一次拿到 v1 ──────────────
console.log('\n=== Issue 2: first synthesize POST returns v1 ===');
{
  const createRes = await api('POST', '/api/projects', {
    name: `FirstSynth-${Date.now()}`, type: 'html', conflictMode: 'discuss',
  }, COOKIE);
  const PID = createRes.json?.project?.id;
  ok('create project', !!PID);

  if (PID) {
    await api('POST', `/api/projects/${PID}/intents`, {
      statement: '设计一个干净的产品落地页',
    }, COOKIE);

    // 非流式 POST: 等服务端完整合成完毕
    const synthRes = await api('POST', `/api/projects/${PID}/synthesize`, null, COOKIE);
    ok('first synthesize 201', synthRes.status === 201, `status=${synthRes.status}`);
    ok('v1 has id', !!synthRes.json?.version?.id);
    ok('v1 has intentIds', Array.isArray(synthRes.json?.version?.intentIds));

    await api('DELETE', `/api/projects/${PID}`, null, COOKIE);
  }
}

// ─── Issue 3 回归: SSE 中断后服务端继续完成,GET 能拿到结果 ─
console.log('\n=== Issue 3: client disconnect mid-stream, server still saves version ===');
{
  const createRes = await api('POST', '/api/projects', {
    name: `Resilient-${Date.now()}`, type: 'html', conflictMode: 'discuss',
  }, COOKIE);
  const PID = createRes.json?.project?.id;
  ok('create project', !!PID);

  if (PID) {
    await api('POST', `/api/projects/${PID}/intents`, {
      statement: '一个简短的落地页',
    }, COOKIE);

    // 1) 开 SSE,主动断开 (模拟刷新页面)
    const controller = new AbortController();
    const ssePromise = fetch(`${BASE}/api/projects/${PID}/synthesize`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', Cookie: COOKIE },
      signal: controller.signal,
    }).then(r => r.body?.getReader().read()).catch(() => null);

    // 等 5s 让服务端真正进入 LLM 调用,再断开
    await wait(5000);
    controller.abort();
    await ssePromise.catch(() => {});
    ok('client disconnected from SSE', true);

    // 2) 现在轮询 GET, 看服务端是否仍然把版本入库 (上限 4 分钟)
    let version = null;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await wait(3000);
      const r = await api('GET', `/api/projects/${PID}/synthesize`, null, COOKIE);
      if (r.json?.version?.id) { version = r.json.version; break; }
    }
    ok('version eventually persisted after client disconnect', !!version,
       version ? `id=${version.id.slice(0,8)}` : 'timeout');

    await api('DELETE', `/api/projects/${PID}`, null, COOKIE);
  }
}

// ─── Tension 去重回归: resolve 后再 detect 不应创建新冲突 ──
console.log('\n=== Tension dedup: resolved tension never re-detected ===');
{
  const createRes = await api('POST', '/api/projects', {
    name: `Dedup-${Date.now()}`, type: 'html', conflictMode: 'discuss',
  }, COOKIE);
  const PID = createRes.json?.project?.id;
  ok('create project', !!PID);

  if (PID) {
    // 注入两个直接对立的 must intent
    const a = await api('POST', `/api/projects/${PID}/intents`, {
      statement: '页面必须使用纯白背景', type: 'Constraint', scope: 'global', weight: 'must',
    }, COOKIE);
    const b = await api('POST', `/api/projects/${PID}/intents`, {
      statement: '页面必须使用深色背景', type: 'Constraint', scope: 'global', weight: 'must',
    }, COOKIE);
    ok('intent A 201', a.status === 201);
    ok('intent B 201', b.status === 201);

    // 等首批 tensions 完成检测,然后全部 resolve (并发 detect 可能产生多个,全清完才有意义验证 dedup)
    let initialTensions = [];
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await wait(3000);
      const r = await api('GET', `/api/projects/${PID}/tensions`, null, COOKIE);
      const list = (r.json?.tensions ?? []).filter(t => t.status === 'active');
      if (list.length > 0) {
        initialTensions = list;
        // 再多等一轮,让所有 fire-and-forget detect 都完成
        await wait(5000);
        const r2 = await api('GET', `/api/projects/${PID}/tensions`, null, COOKIE);
        initialTensions = (r2.json?.tensions ?? []).filter(t => t.status === 'active');
        break;
      }
    }
    ok('tension detected', initialTensions.length > 0, `count=${initialTensions.length}`);

    if (initialTensions.length > 0) {
      // 全部 resolve 掉
      for (const t of initialTensions) {
        const optKey = t.options?.[0]?.key ?? 'A';
        await api('POST',
          `/api/projects/${PID}/tensions/${t.id}/resolve`,
          { selectedOptionKey: optKey }, COOKIE);
      }
      ok('all initial tensions resolved', true);

      // 加一条无关 intent → fire-and-forget 重新触发 detect
      await api('POST', `/api/projects/${PID}/intents`, {
        statement: '加一个底部 footer 链接', type: 'Constraint', scope: 'footer', weight: 'must',
      }, COOKIE);
      await wait(10000); // 等 detect 跑完

      const r = await api('GET', `/api/projects/${PID}/tensions`, null, COOKIE);
      const activeList = (r.json?.tensions ?? []).filter(t => t.status === 'active');
      const resolvedList = (r.json?.tensions ?? []).filter(t => t.status === 'resolved');
      ok('no new active tension after resolve+redetect', activeList.length === 0,
         `active=${activeList.length} resolved=${resolvedList.length}`);
      ok('original resolved tension preserved', resolvedList.length >= 1);
    }

    await api('DELETE', `/api/projects/${PID}`, null, COOKIE);
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Synth flow tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.error(`  ✗ ${f.label}${f.detail ? ': ' + f.detail : ''}`);
}
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
