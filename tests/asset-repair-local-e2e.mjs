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

const wrongInlineSeedHtml = seedHtml
  .replace('logo/FChatGPT.svg', 'data:image/svg+xml,%3Csvg%3Ewrong-chatgpt%3C%2Fsvg%3E')
  .replace('logo/Claude.svg', 'data:image/svg+xml,%3Csvg%3Ewrong-claude%3C%2Fsvg%3E')
  .replace('logo/Gemini.svg', 'data:image/svg+xml,%3Csvg%3Ewrong-gemini%3C%2Fsvg%3E')
  .replace('logo/Perplexity.svg', 'data:image/svg+xml,%3Csvg%3Ewrong-perplexity%3C%2Fsvg%3E');

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

async function createSeedProject(cookie, name, referenceHtml) {
  const created = await api('POST', '/api/projects', {
    name,
    type: 'html',
    conflictMode: 'discuss',
    referenceHtml,
    referenceTitle: 'logo-repair-fixture.html',
    seedIntent: {
      statement: '请基于上传 HTML 作为 v1 起点, 后续只做局部增量修改。',
    },
  }, cookie);
  assert.equal(created.status, 201, created.json.error);
  return created.json.project.id;
}

function section(html, id) {
  const re = new RegExp(`<section[^>]+id=["']${id}["'][\\s\\S]*?<\\/section>`, 'i');
  const m = html.match(re);
  assert.ok(m, `section ${id} exists`);
  return m[0];
}

function dataImageCount(html) {
  return (html.match(/data:image\/svg\+xml,/g) || []).length;
}

const cookie = await login();
const projectIds = [];

try {
  const projectId = await createSeedProject(cookie, `Logo Repair Local ${Date.now()}`, seedHtml);
  projectIds.push(projectId);

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
  assert.match(after, /OpenAI/);
  assert.match(after, /Google%20Gemini/);
  assert.equal(section(after, 'pricing'), beforePricing, 'pricing section unchanged');

  const noChange = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.equal(noChange.status, 422, 'unchanged synthesis must not save a fake version');
  assert.equal(noChange.json.unchanged, true);

  const replaceProjectId = await createSeedProject(cookie, `Logo Replace Local ${Date.now()}`, wrongInlineSeedHtml);
  projectIds.push(replaceProjectId);

  const replaceV1 = await api('POST', `/api/projects/${replaceProjectId}/synthesize`, {}, cookie);
  assert.ok(replaceV1.status === 201 || replaceV1.status === 200, replaceV1.json.error);
  const wrongBefore = replaceV1.json.version.content;
  const wrongBeforePricing = section(wrongBefore, 'pricing');
  assert.match(wrongBefore, /wrong-chatgpt/);

  const replaceIntent = await api('POST', `/api/projects/${replaceProjectId}/intents`, {
    statement: '4 个 ai 平台的 logo 都是错的，请替换成正确的官方 logo',
    type: 'Constraint',
    scope: 'features',
    weight: 'must',
  }, cookie);
  assert.equal(replaceIntent.status, 201, replaceIntent.json.error);

  const v3 = await api('POST', `/api/projects/${replaceProjectId}/synthesize`, {}, cookie);
  assert.ok(v3.status === 201 || v3.status === 200, v3.json.error);
  assert.equal(v3.json.source, 'patch', 'wrong logo replacement should use patch source');
  const replaced = v3.json.version.content;
  assert.notEqual(replaced, wrongBefore, 'wrong inline logos must be overwritten');
  assert.doesNotMatch(replaced, /wrong-chatgpt|wrong-claude|wrong-gemini|wrong-perplexity/);
  assert.equal(dataImageCount(replaced), dataImageCount(wrongBefore), 'replace, do not add duplicate images');
  assert.match(replaced, /OpenAI/);
  assert.match(replaced, /Google%20Gemini/);
  assert.equal(section(replaced, 'pricing'), wrongBeforePricing, 'pricing section unchanged after replacement');

  console.log('asset-repair-local-e2e: ok');
} finally {
  for (const projectId of projectIds) {
    await api('DELETE', `/api/projects/${projectId}`, undefined, cookie).catch(() => undefined);
  }
}
