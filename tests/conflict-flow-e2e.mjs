/**
 * 冲突场景端到端 e2e — 模拟用户实际触发"加 intent → agent 反应 → 合成"全链路。
 *
 * 验证修复后两件事:
 *   1. agent intent 立刻能从 GET /intents 拉到 (RSC payload race 不影响 API 层)
 *   2. v(N+1) 合成的 intent_ids 包含所有 agent intent (顺序对齐)
 *   3. tension 能被检测出来 (Veto vs agent 建议)
 *
 * 用法:
 *   E2E_BASE=https://darwin.org.cn EMAIL=xuxin@deeplumen.com node tests/conflict-flow-e2e.mjs
 */

const BASE = process.env.E2E_BASE || 'https://darwin.org.cn';
const EMAIL = process.env.EMAIL || 'xuxin@deeplumen.com';

// 固定取一个 agent 协作者 — 喷泉 AI (运营视角, persona 偏推转化, 跟 "Veto: 不要 CTA 转化" 直接对立)
const AGENT_ID = process.env.AGENT_ID || '8b442084-6e74-4928-ae77-e497248c30bc';

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
  if (!m) throw new Error('login failed: no darwin_user_id cookie');
  return `darwin_user_id=${m[1]}`;
}

async function api(method, path, body, cookie) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, json };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`=== Conflict-flow e2e (BASE=${BASE}, AGENT=${AGENT_ID}) ===\n`);
  const cookie = await loginAs(EMAIL);
  console.log('login: ok');

  // 1. 创建项目, 把 agent 直接放进 collaboratorIds
  const proj = await api('POST', '/api/projects', {
    name: `Conflict-E2E-${Date.now()}`,
    type: 'html',
    conflictMode: 'discuss',
    collaboratorIds: [AGENT_ID],
  }, cookie);
  ok('create project', proj.status === 201 && proj.json?.project?.id);
  if (!proj.json?.project?.id) { console.error(JSON.stringify(proj.json).slice(0,300)); return; }
  const projectId = proj.json.project.id;
  console.log(`  project=${projectId}`);

  // 2. POST 一条 Veto must intent — 直接喂 type/scope/weight, 跳过 LLM 抽取
  const veto = await api('POST', `/api/projects/${projectId}/intents`, {
    statement: '顶部 CTA 不要指向登录/注册入口, 我们不做转化导向, 主打理念传达。',
    type: 'Veto', scope: 'header.cta', weight: 'must',
  }, cookie);
  ok('POST veto intent', veto.status === 201 && veto.json?.intent?.id);
  if (!veto.json?.intent?.id) { console.error(JSON.stringify(veto.json).slice(0,300)); return; }
  const vetoId = veto.json.intent.id;

  // 3. mimic IntentForm 并发: 立即 POST agent-react
  console.log('  triggering agent reaction (可能 30-60s LLM)...');
  const t0 = Date.now();
  const react = await api('POST', `/api/projects/${projectId}/agent-react`, {
    agentEmployeeId: AGENT_ID,
    triggerIntentId: vetoId,
  }, cookie);
  console.log(`  agent-react: ${react.status} reaction=${react.json?.reaction} (${(Date.now()-t0)/1000}s)`);

  // 4. 验证 agent intent (如果 spoke) 立刻能从 GET /intents 拿到
  let agentIntentId = null;
  if (react.json?.reaction === 'spoke') {
    agentIntentId = react.json?.intent?.id;
    ok('agent-react response 含 intent.id', !!agentIntentId);
    if (agentIntentId) {
      const listed = await api('GET', `/api/projects/${projectId}/intents`, null, cookie);
      const hasIt = (listed.json?.intents || []).some(i => i.id === agentIntentId);
      ok('agent intent 在 GET /intents 立刻可见 (实时性 bug 1)', hasIt,
        hasIt ? '' : `IDs: ${(listed.json?.intents||[]).map(i=>i.id.slice(0,8)).join(',')}`);
    }
  } else {
    console.log(`  agent silent — reason: ${react.json?.reason || '?'} (跳过 agent intent assertion, 继续 tension test)`);
  }

  // 5. 等 detection 跑 — agent-react 内部也会触发 detect-tension (lib/agent-react.ts:172)
  console.log('  waiting 75s for tension detection...');
  await sleep(75_000);

  const tensions = await api('GET', `/api/projects/${projectId}/tensions`, null, cookie);
  const tCount = tensions.json?.tensions?.length || 0;
  ok(`tension 至少 1 个 (实际 ${tCount})`, tCount >= 1);
  for (const t of (tensions.json?.tensions || [])) {
    console.log(`    - [${t.status}|${t.scope}|${t.variant}] intents=${(t.intentIds||[]).map(s=>s.slice(0,8)).join(',')}`);
  }

  // 6. 如果 agent 沉默了, 加一条额外的 should intent 强制制造 tension, 让合成有得跑
  if (!agentIntentId) {
    const helper = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: '运营侧建议顶部/页尾 CTA 直接指向登录或注册入口, 强化转化。',
      type: 'Constraint', scope: 'header.cta', weight: 'should', authorKind: 'agent',
    }, cookie);
    if (helper.json?.intent?.id) agentIntentId = helper.json.intent.id;
  }

  // 7. 触发合成 (SSE 流式 — 直接 POST 普通模式拿 version 即可)
  console.log('  triggering synthesis (~60-120s)...');
  const synth = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  if (synth.status !== 201 && synth.status !== 200) {
    ok('synth completed', false, `status=${synth.status} body=${JSON.stringify(synth.json).slice(0,200)}`);
    return;
  }
  ok('synth completed', true);
  const ver = synth.json?.version;
  ok('version 有 intentIds', Array.isArray(ver?.intentIds));
  if (agentIntentId && ver?.intentIds) {
    ok('合成 version.intentIds 包含 agent intent (顺序对齐 bug 2)',
      ver.intentIds.includes(agentIntentId),
      `agent=${agentIntentId.slice(0,8)} version_ids=[${ver.intentIds.map(s=>s.slice(0,8)).join(',')}]`);
  }

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Conflict-flow: ${passed} passed, ${failed} failed`);
  console.log(`──────────────────────────────────────────────────`);
  if (failed > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  ${f.label}${f.detail ? ': '+f.detail : ''}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
