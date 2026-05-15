/**
 * 给某个已有项目手动触发一次 tension detection
 *
 * 玩法: POST 一条临时意图 -> detectTensionsForProject 在后台跑 -> 等 N 秒 -> 列出 tensions -> DELETE 这条临时意图
 *
 * 用法: BASE=https://darwin.org.cn EMAIL=xuxinmaxen@deeplumen.com PID=<project-uuid> node scripts/nudge-detect-tension.mjs
 */

const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = process.env.EMAIL || 'xuxinmaxen@deeplumen.com';
const PID = process.env.PID;
const WAIT_S = Number(process.env.WAIT_S || '60');

if (!PID) { console.error('需要 PID=<project uuid>'); process.exit(1); }

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
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, json };
}

const cookie = await loginAs(EMAIL);
if (!cookie) { console.error('login failed'); process.exit(1); }
console.log('login: ok');

const before = await api('GET', `/api/projects/${PID}/tensions`, null, cookie);
console.log(`before: ${before.json?.tensions?.length ?? '?'} tensions`);

const NUDGE_STATEMENT = `[__detect_nudge__] ${Date.now()} — 内部触发, 检测完会自动删除`;
const post = await api('POST', `/api/projects/${PID}/intents`, {
  // 必须 must/should/Veto 才会触发后台 detect (见 intents/route.ts 的 fire-and-forget gate)
  statement: NUDGE_STATEMENT, type: 'Reference', scope: 'global', weight: 'should',
}, cookie);
const nudgeId = post.json?.intent?.id;
console.log(`POST nudge intent: ${post.status} id=${nudgeId}`);
if (!nudgeId) { console.error(JSON.stringify(post.json).slice(0,400)); process.exit(1); }

console.log(`waiting ${WAIT_S}s for detection to run...`);
await new Promise(r => setTimeout(r, WAIT_S * 1000));

const after = await api('GET', `/api/projects/${PID}/tensions`, null, cookie);
const tensions = after.json?.tensions || [];
console.log(`\nafter: ${tensions.length} tensions`);
for (const t of tensions) {
  console.log(`  - [${t.status}|${t.scope}|${t.variant}] ${t.summary}`);
  console.log(`    A=${t.partyA?.statement?.slice(0,100) || t.partyAIntentId}`);
  console.log(`    B=${t.partyB?.statement?.slice(0,100) || t.partyBIntentId}`);
}

const del = await api('DELETE', `/api/intents/${nudgeId}`, null, cookie);
console.log(`\nDELETE nudge intent: ${del.status}`);
