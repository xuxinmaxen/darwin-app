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

// ─── Cleanup ──────────────────────────────────────────────

async function cleanupAll() {
  for (const id of cleanup) {
    try {
      await del(`/api/projects/${id}`);
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
