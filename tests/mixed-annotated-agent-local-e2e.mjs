/**
 * Local HTTP E2E for mixed human annotation + agent suggestion synthesis.
 *
 * Run against a local dev server:
 *   BASE=http://localhost:3000 node tests/mixed-annotated-agent-local-e2e.mjs
 */

import assert from 'node:assert/strict';

const BASE = process.env.BASE || process.env.E2E_BASE || 'http://localhost:3000';

const seedHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mixed Annotated Agent Fixture</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0}
section{padding:48px}
#view-welcome-plan{background:#f8fafc}
#pricing{background:#fff}
</style>
</head>
<body>
<section id="view-welcome-plan"><h1>Your products, founded by AI</h1><p>Make every product instantly readable.</p></section>
<section id="pricing"><h2>Pricing</h2><p>Do not touch pricing.</p></section>
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
    name: `Mixed Annotated Agent Local ${Date.now()}`,
    type: 'html',
    conflictMode: 'discuss',
    referenceHtml: seedHtml,
    referenceTitle: 'mixed-annotated-agent-fixture.html',
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

  const humanIntent = await api('POST', `/api/projects/${projectId}/intents`, {
    statement: '【标注修改】\n1. [h1 · "Your products, founded by AI" · at: #view-welcome-plan] 改成 Your store, founded by AI',
    type: 'Constraint',
    scope: 'hero',
    weight: 'must',
  }, cookie);
  assert.equal(humanIntent.status, 201, humanIntent.json.error);

  const agentIntent = await api('POST', `/api/projects/${projectId}/intents`, {
    statement: '建议确认这里是否应写作“Your store, found by AI”，因为“founded by AI”更像是在说店铺由 AI 创办。',
    type: 'Preference',
    scope: 'hero',
    weight: 'should',
    authorKind: 'agent',
  }, cookie);
  assert.equal(agentIntent.status, 201, agentIntent.json.error);

  const v2 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.ok(v2.status === 201 || v2.status === 200, v2.json.error);
  assert.equal(v2.json.source, 'patch', 'mixed update should use patch source');
  const after = v2.json.version.content;

  assert.match(section(after, 'view-welcome-plan'), /Your store, founded by AI/, 'human annotated copy applied');
  assert.doesNotMatch(section(after, 'view-welcome-plan'), /Your products, founded by AI/, 'old copy removed');
  assert.equal(section(after, 'pricing'), beforePricing, 'pricing section unchanged');

  console.log('mixed-annotated-agent-local-e2e: ok');
} finally {
  if (projectId) {
    await api('DELETE', `/api/projects/${projectId}`, undefined, cookie).catch(() => undefined);
  }
}
