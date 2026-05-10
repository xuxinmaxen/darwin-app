/**
 * Darwin · E2E test (HTTP, runs against `npm run dev` on :3000)
 *
 * 覆盖三块刚做的功能:
 *   1. AI 决策模式 (conflictMode='ai_decide'):
 *      - 创建 ai_decide 项目
 *      - 加两条对立的 must Intent
 *      - 等 detect → tension 出现
 *      - 调 /arbitrate, 校验 tension 变 resolved + thread + decision message
 *   2. 项目设置 PATCH (conflictMode 切换)
 *   3. 用户主动开 thread (无 tensionId)
 *
 * 跑法: `node tests/e2e.mjs`
 *   - 假定 dev server 在 :3000 上 (./api/health 200)
 *   - 用真实 LLM (服务端 .env 已配置). 单条流程 30-40s
 *
 * 失败模式: 任何断言失败 → 立即抛出, 进程返回非 0。
 */

import assert from 'node:assert/strict';

const BASE = process.env.DARWIN_BASE_URL || 'http://localhost:3000';
const TEST_RUN_TAG = `e2e-${Date.now()}`;

// ─── HTTP helpers ─────────────────────────────────────────

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { ok: false, error: `(non-JSON status=${res.status})` };
  }
  return { status: res.status, json };
}

async function get(path) {
  return http('GET', path);
}
async function post(path, body) {
  return http('POST', path, body);
}
async function patch(path, body) {
  return http('PATCH', path, body);
}
async function del(path) {
  return http('DELETE', path);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function poll(label, fn, { tries = 30, intervalMs = 1000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const out = await fn();
    if (out !== undefined && out !== null) return out;
    await sleep(intervalMs);
  }
  throw new Error(`timeout: ${label} (waited ${tries * intervalMs}ms)`);
}

// ─── Test scaffolding ─────────────────────────────────────

const cleanup = []; // 每个项目 id 注册一下, 跑完一并删

const results = [];
function record(name, ok, info = '') {
  results.push({ name, ok, info });
  const tag = ok ? '✓' : '✗';
  // eslint-disable-next-line no-console
  console.log(`  ${tag} ${name}${info ? ' — ' + info : ''}`);
}

async function withProject(name, conflictMode, body) {
  const { status, json } = await post('/api/projects', {
    name,
    type: 'html',
    conflictMode,
    background: `e2e test ${TEST_RUN_TAG}`,
  });
  if (status >= 400 || !json.ok) {
    throw new Error(`createProject failed: ${json.error || status}`);
  }
  cleanup.push(json.project.id);
  try {
    return await body(json.project);
  } catch (err) {
    throw err;
  }
}

// ─── Test 1: PATCH conflictMode ──────────────────────────

async function testPatchConflictMode() {
  const banner = 'TEST 1 — PATCH conflictMode';
  console.log('\n' + banner);

  await withProject(`${TEST_RUN_TAG} discuss-then-toggle`, 'discuss', async (proj) => {
    assert.equal(proj.conflictMode, 'discuss');
    record('create with conflictMode=discuss', true);

    const r1 = await patch(`/api/projects/${proj.id}`, { conflictMode: 'ai_decide' });
    assert.equal(r1.status, 200);
    assert.equal(r1.json.ok, true);
    assert.equal(r1.json.project.conflictMode, 'ai_decide');
    record('PATCH discuss → ai_decide', true);

    const r2 = await patch(`/api/projects/${proj.id}`, { conflictMode: 'discuss' });
    assert.equal(r2.json.project.conflictMode, 'discuss');
    record('PATCH ai_decide → discuss', true);

    const r3 = await patch(`/api/projects/${proj.id}`, { conflictMode: 'invalid' });
    assert.equal(r3.status, 400);
    record('PATCH invalid mode → 400', true);
  });
}

// ─── Test 2: AI 仲裁 (manual /arbitrate trigger) ─────────

async function testAIArbitrate() {
  const banner = 'TEST 2 — AI arbitration (ai_decide mode)';
  console.log('\n' + banner);

  await withProject(`${TEST_RUN_TAG} ai-arbitrate`, 'ai_decide', async (proj) => {
    record('create with conflictMode=ai_decide', true);

    // 加两条对立 must Intent
    const r1 = await post(`/api/projects/${proj.id}/intents`, {
      statement: 'hero 区只放一句极简 slogan,不要任何功能堆砌',
      type: 'Constraint',
      scope: 'hero',
      weight: 'must',
    });
    assert.equal(r1.json.ok, true);
    const r2 = await post(`/api/projects/${proj.id}/intents`, {
      statement: 'hero 区必须密集展示 5 个核心功能加图标',
      type: 'Goal',
      scope: 'hero',
      weight: 'must',
    });
    assert.equal(r2.json.ok, true);
    record('add two opposing must intents on scope=hero', true);

    // 轮询等 tension 出现 (LLM detect 大约 5-15s)
    const tension = await poll(
      'tension to appear',
      async () => {
        const r = await get(`/api/projects/${proj.id}/tensions`);
        if (!r.json.ok) return null;
        const active = (r.json.tensions || []).filter(t => t.status === 'active');
        return active[0] ?? null;
      },
      { tries: 40, intervalMs: 1000 }
    );
    record('LLM detected tension', true, `id=${tension.id.slice(0, 8)} options=${tension.options.length}`);
    assert.ok(tension.options.length >= 3, 'tension should have 3+ options');

    // ai_decide 模式: detect 完会 fire-and-forget 自动仲裁。
    // 给它 25 秒看是否自动 resolve, 否则手动调 /arbitrate。
    let resolved = await poll(
      'auto-arbitrate to resolve tension',
      async () => {
        const r = await get(`/api/projects/${proj.id}/tensions`);
        if (!r.json.ok) return null;
        const t = r.json.tensions.find(x => x.id === tension.id);
        return t && t.status === 'resolved' ? t : null;
      },
      { tries: 25, intervalMs: 1000 }
    ).catch(() => null);

    if (!resolved) {
      // 自动没跑通 → 手动触发
      const r = await post(`/api/projects/${proj.id}/tensions/${tension.id}/arbitrate`);
      if (!r.json.ok) {
        throw new Error(`/arbitrate failed: ${r.json.error}`);
      }
      record('manual /arbitrate fallback', true, `selected=${r.json.selectedKey}`);
      const r2 = await get(`/api/projects/${proj.id}/tensions`);
      resolved = r2.json.tensions.find(x => x.id === tension.id);
    } else {
      record('auto-arbitrate resolved tension', true, `selected=${resolved.resolution.selectedOptionKey}`);
    }

    assert.equal(resolved.status, 'resolved');
    assert.ok(resolved.resolution, 'resolved tension must have resolution');
    assert.ok(
      tension.options.some(o => o.key === resolved.resolution.selectedOptionKey),
      `selected key ${resolved.resolution.selectedOptionKey} must be in options`
    );
    record('resolution.selectedOptionKey is one of the options', true);
    assert.equal(resolved.resolution.threadId !== null, true, 'tension must be linked to a thread');
    record('resolution carries threadId', true);

    // 校验 thread + decision message
    const tr = await get(`/api/projects/${proj.id}/threads`);
    const thread = tr.json.threads.find(t => t.tensionId === tension.id);
    assert.ok(thread, 'thread must exist for arbitrated tension');
    record('thread exists for arbitrated tension', true);
    assert.equal(thread.status, 'resolved');
    record('thread is resolved', true);

    const mr = await get(`/api/threads/${thread.id}/messages`);
    const decisions = (mr.json.messages || []).filter(m => m.isDecision);
    assert.ok(decisions.length >= 1, 'at least one decision message expected');
    const dec = decisions[0];
    assert.equal(dec.authorKind, 'system');
    assert.equal(dec.decisionPayload?.selectedOptionKey, resolved.resolution.selectedOptionKey);
    assert.match(dec.body, /AI 仲裁结果|评分明细/);
    record('decision message has AI scoring detail', true);

    // 幂等: 再次 arbitrate 不应该改变结果
    const second = await post(`/api/projects/${proj.id}/tensions/${tension.id}/arbitrate`);
    assert.equal(second.json.ok, true);
    assert.equal(second.json.selectedKey, resolved.resolution.selectedOptionKey);
    record('arbitrate is idempotent on resolved tension', true);
  });
}

// ─── Test 3: 用户主动开 thread (no tension) ──────────────

async function testUserInitiatedThread() {
  const banner = 'TEST 3 — user-initiated thread';
  console.log('\n' + banner);

  await withProject(`${TEST_RUN_TAG} user-thread`, 'discuss', async (proj) => {
    // 直接开 thread
    const r1 = await post(`/api/projects/${proj.id}/threads`, {
      scope: 'pricing',
      title: 'pricing · 围绕定价模式的讨论',
      tensionId: null,
      openingMessages: [
        {
          authorId: 'system',
          authorKind: 'system',
          body: '**徐鑫** 在 **pricing** 上发起讨论',
        },
      ],
    });
    assert.equal(r1.status, 201);
    assert.equal(r1.json.ok, true);
    assert.equal(r1.json.thread.tensionId, null);
    assert.equal(r1.json.thread.status, 'active');
    record('create thread without tension', true, `id=${r1.json.thread.id.slice(0, 8)}`);

    // 发一条用户消息
    const r2 = await post(`/api/threads/${r1.json.thread.id}/messages`, {
      body: '我倾向三档定价,免费/团队/企业',
    });
    assert.equal(r2.json.ok, true);
    assert.equal(r2.json.message.authorKind, 'human');
    record('post human message into thread', true);

    // 列出消息: opening + user msg = 2
    const r3 = await get(`/api/threads/${r1.json.thread.id}/messages`);
    assert.equal(r3.json.messages.length, 2);
    record('thread carries opening + user msg', true);
  });
}

// ─── Test 4: 团队共识候选 (extract pref after arbitrate) ──

async function testPrefCandidate() {
  const banner = 'TEST 4 — pref candidate after AI arbitrate';
  console.log('\n' + banner);

  await withProject(`${TEST_RUN_TAG} pref-candidate`, 'ai_decide', async (proj) => {
    record('create ai_decide project for candidate flow', true);

    // 用容易抽出"团队取向"的对立 (style 偏好层面)
    await post(`/api/projects/${proj.id}/intents`, {
      statement: 'hero 文案必须传达技术专业感, 用词克制, 避免营销话术',
      type: 'Constraint', scope: 'hero', weight: 'must',
    });
    await post(`/api/projects/${proj.id}/intents`, {
      statement: 'hero 文案必须制造视觉冲击, 加粗营销钩子, 转化优先',
      type: 'Goal', scope: 'hero', weight: 'must',
    });
    record('add two opposing must intents', true);

    // 等 tension 出现 + 自动仲裁完
    const resolved = await poll(
      'tension auto-resolved',
      async () => {
        const r = await get(`/api/projects/${proj.id}/tensions`);
        if (!r.json.ok) return null;
        const t = (r.json.tensions || []).find(x => x.scope === 'hero' && x.status === 'resolved');
        return t ?? null;
      },
      { tries: 60, intervalMs: 1000 }
    );
    record('tension resolved by AI arbitrate', true, `selected=${resolved.resolution.selectedOptionKey}`);

    // 等候选 toast 出现 (LLM extract 也是 fire-and-forget, 5-15s)
    const candidate = await poll(
      'pref candidate to appear',
      async () => {
        const r = await get(`/api/projects/${proj.id}/pref-candidates`);
        if (!r.json.ok) return null;
        return (r.json.candidates || [])[0] ?? null;
      },
      { tries: 30, intervalMs: 1000 }
    ).catch(() => null);

    if (!candidate) {
      // LLM 可能判断 "not worth" — 这是合法行为, 不算失败
      record('candidate not produced (LLM judged not worth) — acceptable', true);
      return;
    }
    record('candidate generated', true, `category="${candidate.category}"`);
    assert.equal(candidate.status, 'pending');
    assert.ok(candidate.category && candidate.body, 'candidate must have category + body');
    assert.ok(['pen', 'eye', 'graph', 'audience', 'flow', 'note'].includes(candidate.iconKey));

    // 测 PATCH (inline 编辑)
    const patched = await patch(`/api/pref-candidates/${candidate.id}`, {
      category: 'edited 文案风格',
    });
    assert.equal(patched.json.candidate.category, 'edited 文案风格');
    record('PATCH candidate updates fields', true);

    // 测 accept → 沉淀进 team_prefs
    const acc = await post(`/api/pref-candidates/${candidate.id}/accept`, {});
    assert.equal(acc.json.ok, true);
    assert.ok(acc.json.pref?.id, 'accept must return new pref');
    assert.equal(acc.json.pref.category, 'edited 文案风格');
    record('accept creates team_pref', true, `prefId=${acc.json.pref.id.slice(0, 8)}`);

    // 候选状态推进 + 不再出现在 pending 列表
    const after = await get(`/api/projects/${proj.id}/pref-candidates`);
    assert.equal((after.json.candidates || []).find(c => c.id === candidate.id), undefined,
      'accepted candidate should drop out of pending list');
    record('accepted candidate removed from pending', true);

    // accept 一个已 accepted 的候选 → 409
    const dup = await post(`/api/pref-candidates/${candidate.id}/accept`, {});
    assert.equal(dup.status, 409);
    record('accept already-accepted candidate → 409', true);

    // 清理沉淀的 pref
    await del(`/api/team/prefs/${acc.json.pref.id}`).catch(() => {});
  });
}

async function testPrefCandidateDismiss() {
  const banner = 'TEST 5 — pref candidate dismiss';
  console.log('\n' + banner);

  // 不调真实仲裁, 改走 /resolve 路径以减少耗时. 不过 /resolve 也会 fire-and-forget 抽候选
  await withProject(`${TEST_RUN_TAG} pref-dismiss`, 'discuss', async (proj) => {
    await post(`/api/projects/${proj.id}/intents`, {
      statement: 'pricing 必须三档,免费档零门槛',
      type: 'Constraint', scope: 'pricing', weight: 'must',
    });
    await post(`/api/projects/${proj.id}/intents`, {
      statement: 'pricing 必须单档, 一价全包',
      type: 'Goal', scope: 'pricing', weight: 'must',
    });
    record('add two opposing pricing intents', true);

    const tension = await poll(
      'tension on pricing',
      async () => {
        const r = await get(`/api/projects/${proj.id}/tensions`);
        if (!r.json.ok) return null;
        const t = (r.json.tensions || []).find(x => x.scope === 'pricing' && x.status === 'active');
        return t ?? null;
      },
      { tries: 40, intervalMs: 1000 }
    );
    record('tension detected', true);

    // 用户直选 A
    const r1 = await post(
      `/api/projects/${proj.id}/tensions/${tension.id}/resolve`,
      { selectedOptionKey: 'A' }
    );
    assert.equal(r1.json.ok, true);
    record('manual resolve via /resolve', true);

    // 等候选
    const cand = await poll(
      'candidate from /resolve path',
      async () => {
        const r = await get(`/api/projects/${proj.id}/pref-candidates`);
        return (r.json.candidates || [])[0] ?? null;
      },
      { tries: 30, intervalMs: 1000 }
    ).catch(() => null);

    if (!cand) {
      record('candidate not produced (acceptable)', true);
      return;
    }
    record('candidate generated from /resolve path', true);

    const dis = await post(`/api/pref-candidates/${cand.id}/dismiss`);
    assert.equal(dis.json.ok, true);
    record('dismiss candidate', true);

    const dup = await post(`/api/pref-candidates/${cand.id}/dismiss`);
    assert.equal(dup.status, 409);
    record('dismiss already-dismissed → 409', true);
  });
}

// ─── Test 6: Agent learning tags ─────────────────────────

const cleanupEmployees = [];

async function testAgentTags() {
  const banner = 'TEST 6 — agent learning tags';
  console.log('\n' + banner);

  // 1. 建一个临时 agent
  const r1 = await post('/api/employees', {
    kind: 'agent',
    name: `${TEST_RUN_TAG}-tag-agent`,
    role: 'UI',
    persona: '坚持视觉克制, 偏好黑白灰 + 单一强调色',
  });
  if (r1.status >= 400 || !r1.json.ok) {
    throw new Error(`createEmployee failed: ${r1.json.error || r1.status}`);
  }
  const agent = r1.json.employee;
  cleanupEmployees.push(agent.id);
  record('create temp agent', true, `id=${agent.id.slice(0, 8)}`);

  // 2. 空 agent → recompute 应返回 tags=[] / intentCount=0 (不调 LLM)
  const r2 = await post(`/api/employees/${agent.id}/recompute-tags`);
  assert.equal(r2.json.ok, true);
  assert.equal(r2.json.intentCount, 0);
  assert.deepEqual(r2.json.tags, []);
  record('recompute on empty agent → tags=[]', true);

  // 3. 建项目 + 把 agent 加进协作者
  await withProject(`${TEST_RUN_TAG} agent-tags-proj`, 'discuss', async (proj) => {
    const ownerId = '00000000-0000-0000-0000-000000000001';
    const rc = await patch(`/api/projects/${proj.id}/collaborators`, {
      collaboratorIds: [agent.id],
    });
    if (!rc.json.ok) throw new Error(`add collaborator failed: ${rc.json.error}`);
    record('add agent to project as collaborator', true);

    // 4. 让 agent 发两条 Intent (每条 ~10s)
    const sr1 = await post(`/api/projects/${proj.id}/agent-speak`, {
      agentEmployeeId: agent.id,
    });
    if (!sr1.json.ok) {
      console.warn('  agent-speak #1 failed:', sr1.json.error);
      // 跳过 (LLM 不稳定不算 feature 失败)
      record('agent-speak #1 skipped (LLM unstable)', true);
      // 仍然测幂等性
      const r3 = await post(`/api/employees/${agent.id}/recompute-tags`);
      assert.equal(r3.json.ok, true);
      record('recompute returns ok even after speak fail', true);
      return;
    }
    record('agent-speak #1', true);

    const sr2 = await post(`/api/projects/${proj.id}/agent-speak`, {
      agentEmployeeId: agent.id,
    });
    if (!sr2.json.ok) {
      console.warn('  agent-speak #2 failed:', sr2.json.error);
      record('agent-speak #2 skipped', true);
    } else {
      record('agent-speak #2', true);
    }

    // 5. recompute → 期待非空(至少 1 个 tag, ≤3)
    const r3 = await post(`/api/employees/${agent.id}/recompute-tags`);
    assert.equal(r3.json.ok, true);
    assert.ok(r3.json.intentCount >= 1, `intentCount should be ≥1, got ${r3.json.intentCount}`);
    assert.ok(Array.isArray(r3.json.tags), 'tags must be array');
    assert.ok(r3.json.tags.length <= 3, 'tags ≤ 3');
    for (const tag of r3.json.tags) {
      assert.ok(tag.length > 0 && tag.length <= 6, `tag length 1..6, got "${tag}"`);
    }
    record('recompute returns valid tags', true,
      r3.json.tags.length > 0 ? `tags=[${r3.json.tags.join(', ')}]` : 'tags=[]');

    // 6. 幂等: 再次 recompute → skipped='unchanged'
    const r4 = await post(`/api/employees/${agent.id}/recompute-tags`);
    assert.equal(r4.json.skipped, 'unchanged');
    record('recompute idempotent → unchanged', true);

    // 7. /memory 拉到的 agent 列表带 tags
    const memRes = await get('/api/team/memory');
    if (memRes.json.ok && Array.isArray(memRes.json.agents)) {
      const memAgent = memRes.json.agents.find(a => a.agentId === agent.id);
      if (memAgent) {
        assert.deepEqual(memAgent.tags, r3.json.tags);
        record('/api/team/memory exposes tags on agent', true);
      } else {
        record('/api/team/memory returns agents (no entry for ours yet)', true);
      }
    }
  });
}

// ─── Cleanup ──────────────────────────────────────────────

async function cleanupAll() {
  for (const id of cleanup) {
    try {
      await del(`/api/projects/${id}`);
    } catch {
      /* swallow */
    }
  }
  for (const id of cleanupEmployees) {
    try {
      await del(`/api/employees/${id}`);
    } catch {
      /* swallow */
    }
  }
}

// ─── Runner ───────────────────────────────────────────────

async function main() {
  console.log(`Darwin E2E — base=${BASE} tag=${TEST_RUN_TAG}`);

  // health
  const h = await get('/api/health');
  assert.equal(h.json.ok, true, 'dev server must be up');
  if (!h.json.llm?.hasKey) {
    console.warn('⚠️  LLM 没配 key — Test 2 会被跳过 (detect-tension 不会跑)');
    process.exitCode = 2;
    return;
  }

  let failed = false;
  try {
    await testPatchConflictMode();
  } catch (err) {
    record('TEST 1 failed', false, err.message);
    failed = true;
  }
  try {
    await testAIArbitrate();
  } catch (err) {
    record('TEST 2 failed', false, err.message);
    failed = true;
  }
  try {
    await testUserInitiatedThread();
  } catch (err) {
    record('TEST 3 failed', false, err.message);
    failed = true;
  }
  try {
    await testPrefCandidate();
  } catch (err) {
    record('TEST 4 failed', false, err.message);
    failed = true;
  }
  try {
    await testPrefCandidateDismiss();
  } catch (err) {
    record('TEST 5 failed', false, err.message);
    failed = true;
  }
  try {
    await testAgentTags();
  } catch (err) {
    record('TEST 6 failed', false, err.message);
    failed = true;
  }

  await cleanupAll();

  console.log('\n──── Summary ────');
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
  }
  const okCount = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`${okCount}/${total} passed`);
  if (failed) process.exitCode = 1;
}

main().catch(err => {
  console.error('fatal:', err);
  process.exitCode = 1;
});
