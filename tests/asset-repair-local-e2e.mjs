/**
 * Local HTTP E2E for screenshot-driven logo repair.
 *
 * Run against a local dev server:
 *   BASE=http://localhost:3000 node tests/asset-repair-local-e2e.mjs
 */

import assert from 'node:assert/strict';

const BASE = process.env.BASE || process.env.E2E_BASE || 'http://localhost:3000';

const seedHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Logo Repair Fixture</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0}
section{padding:48px}
.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.flow-node{border:1px solid #ddd;border-radius:12px;padding:20px;text-align:center}
.flow-node-logo{width:32px;height:32px;display:block;margin:0 auto 10px}
</style>
</head>
<body>
<section id="ai-flow" data-scope="features">
  <h2>AI platforms</h2>
  <div class="flow">
    <div class="flow-node"><img class="flow-node-logo" src="logo/FChatGPT.svg" alt=""><span>ChatGPT</span></div>
    <div class="flow-node"><img class="flow-node-logo" src="logo/Claude.svg" alt=""><span>Claude</span></div>
    <div class="flow-node"><img class="flow-node-logo" src="logo/Gemini.svg" alt=""><span>Gemini</span></div>
    <div class="flow-node"><img class="flow-node-logo" src="logo/Perplexity.svg" alt=""><span>Perplexity</span></div>
  </div>
</section>
<section id="pricing" data-scope="pricing"><h2>Pricing</h2><p>Do not touch pricing.</p></section>
</body>
</html>`;

async function api(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

async function login() {
  const r = await api('POST', '/api/auth/login', {
    email: process.env.EMAIL || 'xuxin@deeplumen.com',
    code: '123456',
  });
  const m = r.headers.get('set-cookie')?.match(/darwin_user_id=([^;]+)/);
  assert.ok(m, 'login returns darwin_user_id cookie');
  return `darwin_user_id=${m[1]}`;
}

function section(html, id) {
  const re = new RegExp(`<section[^>]+id=["']${id}["'][\\s\\S]*?<\\/section>`, 'i');
  const m = html.match(re);
  assert.ok(m, `section ${id} exists`);
  return m[0];
}

const cookie = await login();
let projectId = null;

try {
  const created = await api('POST', '/api/projects', {
    name: `Logo Repair Local ${Date.now()}`,
    type: 'html',
    conflictMode: 'discuss',
    referenceHtml: seedHtml,
    referenceTitle: 'logo-repair-fixture.html',
    seedIntent: {
      statement: '请基于上传 HTML 作为 v1 起点, 后续只做局部增量修改。',
    },
  }, cookie);
  assert.equal(created.status, 201, created.json.error);
  projectId = created.json.project.id;

  const v1 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.ok(v1.status === 201 || v1.status === 200, v1.json.error);
  const before = v1.json.version.content;
  const beforePricing = section(before, 'pricing');
  assert.match(before, /src="logo\/FChatGPT\.svg"/);

  const intent = await api('POST', `/api/projects/${projectId}/intents`, {
    statement: '请看我上传的截图的红色框中部分，几个 ai 平台的 logo 都缺失了，请直接补全\n\n【参考图片: image.png】https://example.com/image.png',
    type: 'Constraint',
    scope: 'features',
    weight: 'must',
  }, cookie);
  assert.equal(intent.status, 201, intent.json.error);

  const v2 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.ok(v2.status === 201 || v2.status === 200, v2.json.error);
  assert.equal(v2.json.source, 'patch', 'logo repair should use patch source');
  const after = v2.json.version.content;

  assert.doesNotMatch(after, /src="logo\/FChatGPT\.svg"/);
  assert.doesNotMatch(after, /src="logo\/Claude\.svg"/);
  assert.doesNotMatch(after, /src="logo\/Gemini\.svg"/);
  assert.doesNotMatch(after, /src="logo\/Perplexity\.svg"/);
  assert.match(after, /data:image\/svg\+xml,/);
  assert.equal(section(after, 'pricing'), beforePricing, 'pricing section unchanged');

  const noChange = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.equal(noChange.status, 422, 'unchanged synthesis must not save a fake version');
  assert.equal(noChange.json.unchanged, true);

  console.log('asset-repair-local-e2e: ok');
} finally {
  if (projectId) {
    await api('DELETE', `/api/projects/${projectId}`, undefined, cookie).catch(() => undefined);
  }
}
