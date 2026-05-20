/**
 * Observer + Retrospect e2e — 验证 端到端:
 *   1. tension 解决后, resolution.retrospect 由 LLM 生成并落库 (Feature B)
 *   2. timeline 出现 kind='retrospect' 事件, body 含 lesson (Feature B)
 *   3. (软断言) /api/projects/[id]/intents 可能多出 '【观察】' 前缀的 intent (Feature A 主动观察)
 *
 * 注: 原版还含 Pulse 断言, 用户已撤掉 Pulse 视图, 测试同步删除 pulse 段。
 *
 * 设计要点:
 *   - 测试目标默认 https://darwin.org.cn (prod), 可用 E2E_BASE 覆盖
 *   - 每轮 timestamp 不同, 项目命名 PRPulse-E2E-{round}-{ts}, 互不撞数据
 *   - 测试结束自动 DELETE 项目 (cascade 把 intents/tensions/learnings 都清掉)
 *
 * 用法:
 *   E2E_BASE=https://darwin.org.cn EMAIL=xuxin@deeplumen.com node tests/observer-retrospect-pulse-e2e.mjs [round]
 */

const BASE = process.env.E2E_BASE || 'https://darwin.org.cn';
const EMAIL = process.env.EMAIL || 'xuxin@deeplumen.com';
const AGENT_ID = process.env.AGENT_ID || '8b442084-6e74-4928-ae77-e497248c30bc';
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
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`=== Observer+Retrospect+Pulse e2e — Round ${ROUND}`);
  console.log(`    BASE=${BASE}   AGENT=${AGENT_ID.slice(0, 8)}…`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  const cookie = await loginAs(EMAIL);
  console.log('login: ok');

  const ts = Date.now();
  let projectId = null;

  try {
    // 1. 建项目
    const proj = await api('POST', '/api/projects', {
      name: `PRPulse-E2E-${ROUND}-${ts}`,
      type: 'html',
      conflictMode: 'discuss',
      collaboratorIds: [AGENT_ID],
    }, cookie);
    ok('create project', proj.status === 201 && proj.json?.project?.id);
    if (!proj.json?.project?.id) {
      console.error('  abort:', JSON.stringify(proj.json).slice(0, 300));
      return;
    }
    projectId = proj.json.project.id;
    console.log(`  project=${projectId.slice(0, 8)}…`);

    // 2. 两条对立意图 (跟 conflict-flow 一样的 textbook 对立: Veto 反 CTA + Constraint 支持 CTA)
    const veto = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: '顶部 CTA 不要指向登录/注册入口, 我们不做转化导向, 主打理念传达。',
      type: 'Veto', scope: 'header.cta', weight: 'must',
    }, cookie);
    ok('POST veto intent', veto.status === 201 && veto.json?.intent?.id);
    const vetoId = veto.json?.intent?.id;

    const helper = await api('POST', `/api/projects/${projectId}/intents`, {
      statement: '运营侧建议顶部 CTA 直接指向登录或注册入口, 强化转化路径, 不要做软引导。',
      type: 'Constraint', scope: 'header.cta', weight: 'should', authorKind: 'agent',
    }, cookie);
    ok('POST agent helper intent', helper.status === 201 && helper.json?.intent?.id);
    const helperId = helper.json?.intent?.id;
    if (!vetoId || !helperId) return;

    // 3. 等 tension detection (detect-tension fire-and-forget, ~30-60s)
    console.log('  waiting 75s for tension detection...');
    await sleep(75_000);

    const tensions = await api('GET', `/api/projects/${projectId}/tensions`, null, cookie);
    const tList = tensions.json?.tensions || [];
    ok(`tension count >= 1 (实际 ${tList.length})`, tList.length >= 1);
    if (tList.length === 0) {
      console.error('  abort: no tensions detected, can\'t resolve');
      return;
    }
    // 找 veto vs helper 这对
    let target = tList.find(t =>
      (t.intentIds || []).includes(vetoId) && (t.intentIds || []).includes(helperId)
    );
    if (!target) target = tList[0]; // fallback 任意一个
    const tensionId = target.id;
    console.log(`  tension=${tensionId.slice(0, 8)}… scope=${target.scope} variant=${target.variant}`);
    ok('tension is active', target.status === 'active');

    // 4. resolve tension — 选 options[0] 或 'custom'
    const optKey = (target.options?.[0]?.key) || 'A';
    const resolve = await api('POST', `/api/projects/${projectId}/tensions/${tensionId}/resolve`, {
      selectedOptionKey: optKey,
    }, cookie);
    ok('resolve tension 200', resolve.status === 200);
    ok('resolve.tension.status = resolved', resolve.json?.tension?.status === 'resolved');

    // 5. 等 after() 块跑完 — retrospect LLM + observe LLM 各 25s timeout, allSettled
    //    实际通常 12-20s 后两者都返回; 给 45s 余量
    console.log('  waiting 45s for retrospect + observe LLM in after()...');
    await sleep(45_000);

    // 6. 验证 retrospect 落库
    const tensionsAfter = await api('GET', `/api/projects/${projectId}/tensions`, null, cookie);
    const resolvedTension = (tensionsAfter.json?.tensions || []).find(t => t.id === tensionId);
    ok('resolved tension still queryable', !!resolvedTension);
    const retro = resolvedTension?.resolution?.retrospect;
    ok('resolution.retrospect 存在', !!retro,
      retro ? '' : `resolution=${JSON.stringify(resolvedTension?.resolution).slice(0, 200)}`);
    if (retro) {
      ok('retrospect.summary 非空', typeof retro.summary === 'string' && retro.summary.length > 5);
      ok('retrospect.lesson 非空 且 ≤36 字', typeof retro.lesson === 'string' && retro.lesson.length > 0 && retro.lesson.length <= 36);
      ok('retrospect.durationMinutes >= 0', typeof retro.durationMinutes === 'number' && retro.durationMinutes >= 0);
      ok('retrospect.yieldedBy 是数组', Array.isArray(retro.yieldedBy));
      console.log(`    summary: ${retro.summary?.slice(0, 80)}…`);
      console.log(`    lesson: ${retro.lesson}`);
    }

    // 7. 验证 team memory timeline 包含 retrospect 事件
    const mem = await api('GET', '/api/team/memory', null, cookie);
    const timeline = mem.json?.timeline || [];
    const retroEvents = timeline.filter(e => e.kind === 'retrospect');
    ok(`timeline 含 retrospect 事件 (共 ${retroEvents.length} 条)`, retroEvents.length >= 1);
    const myRetro = retroEvents.find(e => e.projectId === projectId);
    ok('本项目的 retrospect 出现在 timeline', !!myRetro,
      myRetro ? `body="${myRetro.body?.slice(0, 60)}"` : `projectIds=${retroEvents.map(e => e.projectId?.slice(0, 8)).join(',')}`);

    // 8. (软断言) 主动观察 — 看是不是多了带 【观察】 前缀的 agent intent
    const finalIntents = await api('GET', `/api/projects/${projectId}/intents`, null, cookie);
    const observationIntents = (finalIntents.json?.intents || []).filter(i =>
      i.authorKind === 'agent' && i.statement?.startsWith('【观察】')
    );
    console.log(`  [soft] agent 主动观察 intent 数: ${observationIntents.length} (LLM 可能判定不该说话, 不强制)`);
    if (observationIntents.length > 0) {
      console.log(`    示例: ${observationIntents[0].statement.slice(0, 100)}…`);
    }

  } finally {
    // 9. 清理 — 删项目, FK cascade 清掉 intents/tensions/learnings
    if (projectId) {
      const del = await api('DELETE', `/api/projects/${projectId}`, null, cookie);
      console.log(`  cleanup: DELETE project ${projectId.slice(0, 8)}… → ${del.status}`);
    }
  }

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Round ${ROUND} result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  }
  console.log(`──────────────────────────────────────────────────\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('e2e crashed:', err);
  process.exit(2);
});
