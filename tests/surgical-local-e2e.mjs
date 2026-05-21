/**
 * Local HTTP E2E for surgical free-text incremental edits.
 *
 * Run against a local dev server:
 *   BASE=http://localhost:3000 node tests/surgical-local-e2e.mjs
 */

import assert from 'node:assert/strict';

const BASE = process.env.BASE || process.env.E2E_BASE || 'http://localhost:3000';

const seedHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Surgical Fixture</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0}
section{padding:48px}
.hero{background:#f8fafc}
.features{background:#fff}
.pricing{background:#f9fafb}
.cta{background:#111827;color:white}
</style>
</head>
<body>
<header data-scope="navigation"><a href="#hero">Home</a><a href="#features">Features</a><a href="#pricing">Pricing</a></header>
<section id="hero" class="hero" data-scope="hero"><h1>Darwin Alpha</h1><p>Original hero copy stays stable.</p><button>Start now</button></section>
<section id="features" class="features" data-scope="features"><h2>Features</h2><article><h3>Fast collaboration</h3><p>Teams contribute intent without losing context.</p></article></section>
<section id="pricing" class="pricing" data-scope="pricing"><h2>Pricing</h2><div class="tier"><strong>Team</strong><p>Original price is ¥99.</p><button>Buy Team</button></div></section>
<section id="cta" class="cta" data-scope="cta"><h2>Ready?</h2><p>Original CTA copy.</p><button>Contact us</button></section>
<footer data-scope="footer">Original footer links</footer>
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
    name: `Surgical Local ${Date.now()}`,
    type: 'html',
    conflictMode: 'discuss',
    referenceHtml: seedHtml,
    referenceTitle: 'surgical-fixture.html',
    seedIntent: {
      statement: '请基于上传 HTML 作为 v1 起点, 后续只做局部增量修改。',
    },
  }, cookie);
  assert.equal(created.status, 201, created.json.error);
  projectId = created.json.project.id;

  const v1 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.ok(v1.status === 201 || v1.status === 200, v1.json.error);
  const before = v1.json.version.content;
  const beforeHero = section(before, 'hero');
  const beforeFeatures = section(before, 'features');
  const beforeCta = section(before, 'cta');

  const intent = await api('POST', `/api/projects/${projectId}/intents`, {
    statement: 'pricing 区的 Team 价格从 ¥99 改成 ¥199，只改这个价格，其他模块不要动',
    type: 'Constraint',
    scope: 'pricing',
    weight: 'must',
  }, cookie);
  assert.equal(intent.status, 201, intent.json.error);

  const v2 = await api('POST', `/api/projects/${projectId}/synthesize`, {}, cookie);
  assert.ok(v2.status === 201 || v2.status === 200, v2.json.error);
  assert.equal(v2.json.source, 'patch', 'incremental update should use patch source');
  const after = v2.json.version.content;

  assert.equal(section(after, 'hero'), beforeHero, 'hero section unchanged');
  assert.equal(section(after, 'features'), beforeFeatures, 'features section unchanged');
  assert.equal(section(after, 'cta'), beforeCta, 'cta section unchanged');
  assert.match(section(after, 'pricing'), /¥199/, 'pricing changed to ¥199');
  assert.doesNotMatch(section(after, 'pricing'), /Original price is ¥99/, 'old pricing removed');

  console.log('surgical-local-e2e: ok');
} finally {
  if (projectId) {
    await api('DELETE', `/api/projects/${projectId}`, undefined, cookie).catch(() => undefined);
  }
}
