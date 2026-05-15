/**
 * 3-round 模拟用户流程 e2e
 *
 * 每轮: 1) 构造一份模拟站点 HTML (含各种链接 corner case)
 *      2) POST /api/projects { referenceHtml, referenceUrl } 创建项目
 *      3) POST /api/intents 加一条 intent
 *      4) POST /synthesize 触发合成 (走 SSE), 等到 saved
 *      5) GET 最终 version, 抓回 finalHtml
 *      6) 检查 LLM 输出层面: 同源 <a href> 必须已被改成 hash anchor; 外站保留并加 _blank
 *      7) 把 finalHtml 过一遍 prepareIframeHtml (inline copy), 检查渲染层面: 无任何 href 指向网络的同源 URL
 *
 * Round 1: 大量同源 absolute / root path / relative 链接 — 核心场景
 * Round 2: 同时含真外站 (twitter/github) 不能被误判
 * Round 3: 奇葩 case — 协议无关、大小写、query/fragment、尾斜杠相对
 */

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
let totalPassed = 0, totalFailed = 0;
const allFailures = [];

function ok(round, label, cond, detail = '') {
  if (cond) { console.log(`  [R${round}] ✓ ${label}`); totalPassed++; }
  else { console.error(`  [R${round}] ✗ ${label}${detail ? ': ' + detail : ''}`); totalFailed++; allFailures.push({ round, label, detail }); }
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

/** inline copy of prepareIframeHtml (与 src/components/ProjectCanvas.tsx 保持同步) */
function prepareIframeHtml(html, sourceUrl) {
  function escapeAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  let s = html;
  let sourceHost = null;
  if (sourceUrl) { try { sourceHost = new URL(sourceUrl).host.toLowerCase(); } catch {} }
  const pathToAnchor = (path) => {
    let cleaned = path.split(/[?#]/)[0].replace(/^\/+/, '').replace(/\/+$/, '');
    if (!cleaned) return '#top';
    cleaned = cleaned.replace(/\.(html?|php|aspx?|jsp)$/i, '');
    if (!cleaned) return '#top';
    return '#' + cleaned.replace(/\//g, '-');
  };
  const baseTag = sourceUrl ? `<base href="${escapeAttr(sourceUrl)}">` : '';
  if (baseTag) {
    if (/<base\b[^>]*>/i.test(s)) s = s.replace(/<base\b[^>]*>/i, baseTag);
    else if (/<head\b[^>]*>/i.test(s)) s = s.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    else s = `<head>${baseTag}</head>` + s;
  } else if (/<base\b[^>]*>/i.test(s)) s = s.replace(/<base\b[^>]*>/i, '');
  if (/<body\b[^>]*>/i.test(s) && !/<a\b[^>]*id\s*=\s*["']top["']/i.test(s))
    s = s.replace(/(<body\b[^>]*>)/i, '$1<a id="top" aria-hidden="true"></a>');
  s = s.replace(/<a\b([^>]*?)\shref\s*=\s*("|')([^"']*)\2([^>]*)>/gi, (full, before, q, href, after) => {
    const cleanedHref = (href || '').trim();
    const stripTarget = (x) => x.replace(/\s+target\s*=\s*["'][^"']*["']/gi, '');
    const stripRel = (x) => x.replace(/\s+rel\s*=\s*["'][^"']*["']/gi, '');
    const beforeC = stripRel(stripTarget(before));
    const afterC = stripRel(stripTarget(after));
    if (!cleanedHref || cleanedHref === '#') return full;
    if (cleanedHref.startsWith('#')) return full;
    if (/^javascript:/i.test(cleanedHref)) return `<a${beforeC} href="#"${afterC}>`;
    if (/^(mailto:|tel:|sms:)/i.test(cleanedHref)) return `<a${beforeC} href="${cleanedHref}"${afterC}>`;
    if (/^\/\//.test(cleanedHref)) {
      try {
        const u = new URL('https:' + cleanedHref);
        if (sourceHost && u.host.toLowerCase() === sourceHost) return `<a${beforeC} href="${pathToAnchor(u.pathname)}"${afterC}>`;
        return `<a${beforeC} href="https:${cleanedHref}" target="_blank" rel="noopener noreferrer"${afterC}>`;
      } catch { return `<a${beforeC} href="#"${afterC}>`; }
    }
    if (/^https?:\/\//i.test(cleanedHref)) {
      try {
        const u = new URL(cleanedHref);
        if (sourceHost && u.host.toLowerCase() === sourceHost) return `<a${beforeC} href="${pathToAnchor(u.pathname)}"${afterC}>`;
        return `<a${beforeC} href="${cleanedHref}" target="_blank" rel="noopener noreferrer"${afterC}>`;
      } catch { return `<a${beforeC} href="#"${afterC}>`; }
    }
    if (cleanedHref === '/') return `<a${beforeC} href="#top"${afterC}>`;
    if (cleanedHref.startsWith('/')) return `<a${beforeC} href="${pathToAnchor(cleanedHref)}"${afterC}>`;
    return `<a${beforeC} href="${pathToAnchor(cleanedHref)}"${afterC}>`;
  });
  s = s.replace(/<form\b([^>]*?)\saction\s*=\s*("|')([^"']*)\2([^>]*)>/gi, (full, before, q, action, after) => {
    const a = (action || '').trim();
    if (!a || a === '#' || a.startsWith('#')) return full;
    if (/^(mailto:|tel:)/i.test(a)) return full;
    return `<form${before} action="#"${after}>`;
  });
  return s;
}

/** 收集所有 <a href> 值 */
function collectHrefs(html) {
  const re = /<a\b[^>]*?\shref\s*=\s*("|')([^"']*)\1/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[2]);
  return out;
}
function collectFormActions(html) {
  const re = /<form\b[^>]*?\saction\s*=\s*("|')([^"']*)\1/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[2]);
  return out;
}

/** 等 SSE 跑完 (saved/error 事件) — 返回 final version */
async function runSynthAndWait(pid, cookie) {
  const r = await fetch(`${BASE}/api/projects/${pid}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: cookie },
    body: JSON.stringify({}),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', saved = null, errMsg = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const evtBlock = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = evtBlock.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const evt = JSON.parse(dataLine.slice(5).trim());
        if (evt.type === 'saved') saved = evt;
        else if (evt.type === 'error') errMsg = evt.message;
      } catch {}
    }
  }
  if (errMsg) throw new Error(`synth error: ${errMsg}`);
  if (!saved) throw new Error('saved event missing');
  return saved.version;
}

async function runRound(roundIdx, cfg, cookie) {
  console.log(`\n=== Round ${roundIdx}: ${cfg.label} ===`);
  const t0 = Date.now();

  const create = await api('POST', '/api/projects', {
    name: `UFlow-R${roundIdx}-${Date.now()}`,
    type: 'html',
    conflictMode: 'discuss',
    referenceUrl: cfg.referenceUrl,
    referenceTitle: cfg.referenceTitle,
    referenceHtml: cfg.referenceHtml,
  }, cookie);
  ok(roundIdx, 'create project', !!create.json?.project?.id, JSON.stringify(create.json).slice(0, 200));
  const pid = create.json?.project?.id;
  if (!pid) return;

  await api('POST', `/api/projects/${pid}/intents`, {
    statement: cfg.intent, type: 'Constraint', scope: 'global', weight: 'must',
  }, cookie);

  let finalHtml;
  try {
    const v = await runSynthAndWait(pid, cookie);
    finalHtml = v?.content || '';
    ok(roundIdx, 'synth completed', !!finalHtml, `version length=${finalHtml.length}, ${Math.round((Date.now()-t0)/1000)}s`);
  } catch (err) {
    ok(roundIdx, 'synth completed', false, err.message);
    return;
  }

  // === 检查 1: LLM 输出层 — 不能保留任何指向源站的绝对/相对 URL ===
  const llmHrefs = collectHrefs(finalHtml);
  const llmActions = collectFormActions(finalHtml);
  console.log(`  [R${roundIdx}] (${llmHrefs.length} <a> hrefs, ${llmActions.length} form actions in LLM output)`);

  const srcHost = new URL(cfg.referenceUrl).host.toLowerCase();
  const badLlmHrefs = llmHrefs.filter(h => {
    const t = h.trim();
    if (!t || t.startsWith('#')) return false;
    if (/^(mailto:|tel:|sms:|javascript:)/i.test(t)) return false;
    // hash 始终安全
    // 检查同源 absolute
    try {
      const u = new URL(t, cfg.referenceUrl);
      if (u.host.toLowerCase() === srcHost) {
        // 同源 URL 还原成 absolute 后仍指向源站 → bad (无论原 href 是 / /x x.html https://...)
        return true;
      }
    } catch { return true; }
    return false;
  });
  ok(roundIdx, 'LLM 输出无同源链接', badLlmHrefs.length === 0,
    badLlmHrefs.length ? `${badLlmHrefs.length} bad hrefs, sample: ${badLlmHrefs.slice(0, 3).join(' | ')}` : '');

  const badLlmActions = llmActions.filter(a => {
    const t = a.trim();
    if (!t || t === '#' || t.startsWith('#')) return false;
    if (/^(mailto:|tel:|sms:)/i.test(t)) return false;
    try {
      const u = new URL(t, cfg.referenceUrl);
      return u.host.toLowerCase() === srcHost;
    } catch { return true; }
  });
  ok(roundIdx, 'LLM 输出无同源 form action', badLlmActions.length === 0,
    badLlmActions.length ? `sample: ${badLlmActions.slice(0, 3).join(' | ')}` : '');

  // === 检查 2: 渲染层 — prepareIframeHtml 处理后必须无任何指向同源/相对的网络链接 ===
  const rendered = prepareIframeHtml(finalHtml, cfg.referenceUrl);
  const renderedHrefs = collectHrefs(rendered);
  const renderedActions = collectFormActions(rendered);

  const badRenderHrefs = renderedHrefs.filter(h => {
    const t = h.trim();
    if (!t || t.startsWith('#')) return false;
    if (/^(mailto:|tel:|sms:|javascript:)/i.test(t)) return false;
    // 渲染后所有应该是 hash anchor 或真外站; 不能存在任何相对/同源绝对
    try {
      const u = new URL(t, cfg.referenceUrl);
      if (u.host.toLowerCase() === srcHost) return true; // 渲染后仍指向源站 = bug
    } catch { return true; }
    return false;
  });
  ok(roundIdx, '渲染后无同源 <a href>', badRenderHrefs.length === 0,
    badRenderHrefs.length ? `${badRenderHrefs.length} bad, sample: ${badRenderHrefs.slice(0, 3).join(' | ')}` : '');

  const badRenderActions = renderedActions.filter(a => {
    const t = a.trim();
    if (!t || t === '#' || t.startsWith('#')) return false;
    if (/^(mailto:|tel:)/i.test(t)) return false;
    return true; // 渲染后 form action 只能是 # / mailto / tel
  });
  ok(roundIdx, '渲染后无网络 form action', badRenderActions.length === 0,
    badRenderActions.length ? `sample: ${badRenderActions.slice(0, 3).join(' | ')}` : '');

  // === 检查 3: 真外站应保留 + target=_blank ===
  if (cfg.expectExternalHosts && cfg.expectExternalHosts.length) {
    for (const extHost of cfg.expectExternalHosts) {
      const extLinks = renderedHrefs.filter(h => {
        try { return new URL(h, cfg.referenceUrl).host.toLowerCase() === extHost; } catch { return false; }
      });
      ok(roundIdx, `渲染后保留外站 ${extHost}`, extLinks.length >= 1, `found ${extLinks.length}`);
      // 检查 target=_blank 存在
      if (extLinks.length) {
        const reExt = new RegExp(`<a\\b[^>]*href="[^"]*${extHost.replace('.','\\.')}[^"]*"[^>]*target="_blank"`, 'i');
        ok(roundIdx, `外站 ${extHost} 有 target=_blank`, reExt.test(rendered));
      }
    }
  }

  // === 检查 4: HTML 完整性 — 不被截断 ===
  ok(roundIdx, 'HTML 以 </html> 或 </body> 结尾', /<\/html>\s*$/i.test(finalHtml.trim()) || /<\/body>\s*$/i.test(finalHtml.trim()),
    `tail: ...${finalHtml.slice(-80)}`);

  return { pid, finalHtml };
}

// 三个 Round 配置
const rounds = [
  {
    label: '同源链接为主 (logo + nav + footer + CTA)',
    referenceUrl: 'https://acmestudio.com',
    referenceTitle: 'Acme Studio',
    intent: '把品牌名从 Acme 改成 Beacon, 保留所有视觉样式',
    referenceHtml: `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><title>Acme Studio — Build AI-native products</title>
<style>:root{--accent:#5B5BD6;font-family:-apple-system,sans-serif}body{margin:0;background:#fafafa;color:#0d0d12}header{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;border-bottom:1px solid #ececec}nav a{margin-right:24px;color:#525560;text-decoration:none}section{padding:64px 32px;max-width:1100px;margin:0 auto}.hero{text-align:center}.btn{display:inline-block;padding:12px 24px;background:var(--accent);color:#fff;border-radius:8px;text-decoration:none}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.card{padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}</style>
</head><body>
<header>
  <a href="/" class="logo"><strong>Acme</strong></a>
  <nav>
    <a href="/features">Features</a>
    <a href="/pricing">Pricing</a>
    <a href="https://acmestudio.com/customers">Customers</a>
    <a href="/docs">Docs</a>
  </nav>
  <a href="/signup" class="btn">Sign up</a>
</header>
<section class="hero">
  <h1>Build AI-native products with your team</h1>
  <p>Acme is the collaborative canvas where humans and agents shape ideas into shipping software.</p>
  <a href="/signup" class="btn">Start free</a>
</section>
<section id="features">
  <h2>Features</h2>
  <div class="cards">
    <div class="card"><h3>Intent threads</h3><p>Turn comments into structured intents.</p><a href="/features/intents">Learn more</a></div>
    <div class="card"><h3>Agent peers</h3><p>Atlas and Lyra work alongside your team.</p><a href="/features/agents">Learn more</a></div>
    <div class="card"><h3>Living memory</h3><p>The team's evolving design language.</p><a href="/features/memory">Learn more</a></div>
  </div>
</section>
<section id="pricing">
  <h2>Pricing</h2>
  <p><a href="/pricing">See plans</a></p>
</section>
<footer>
  <p><a href="https://acmestudio.com/about">About</a> · <a href="/blog">Blog</a> · <a href="/contact">Contact</a></p>
  <form action="/newsletter"><input name="email"/><button>Subscribe</button></form>
</footer>
</body></html>`,
  },
  {
    label: '同源 + 真外站混合 (twitter/github)',
    referenceUrl: 'https://lumen-os.io',
    referenceTitle: 'Lumen OS',
    intent: '把 Lumen 改成 Aurora',
    expectExternalHosts: ['twitter.com', 'github.com'],
    referenceHtml: `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><title>Lumen OS — open source agent runtime</title>
<style>body{margin:0;font-family:system-ui;background:#0d0e12;color:#e8e8ed}header{display:flex;justify-content:space-between;padding:20px 40px;border-bottom:1px solid #1f2026}a{color:#9ca3ff;text-decoration:none}section{padding:80px 40px;max-width:980px;margin:0 auto}.btn{padding:10px 20px;background:#9ca3ff;color:#0d0e12;border-radius:6px;font-weight:600}footer{padding:24px 40px;border-top:1px solid #1f2026;display:flex;gap:24px;justify-content:center}</style>
</head><body>
<header>
  <a href="/" class="logo"><strong>Lumen</strong></a>
  <nav>
    <a href="/docs">Docs</a>
    <a href="https://lumen-os.io/sdk">SDK</a>
    <a href="https://github.com/lumen-os/runtime">GitHub</a>
  </nav>
  <a href="https://lumen-os.io/discord" class="btn">Join Discord</a>
</header>
<section>
  <h1>Open-source runtime for autonomous agents.</h1>
  <p>Lumen OS is a Rust-based runtime that schedules, sandboxes, and bills agent workloads.</p>
  <p><a href="/install" class="btn">Install</a> <a href="https://github.com/lumen-os/runtime/releases">Releases</a></p>
</section>
<section id="why">
  <h2>Why Lumen</h2>
  <p>Read the design doc at <a href="https://lumen-os.io/design">design docs</a> or <a href="https://twitter.com/lumen_os">follow us</a>.</p>
</section>
<footer>
  <a href="https://twitter.com/lumen_os">Twitter</a>
  <a href="https://github.com/lumen-os">GitHub</a>
  <a href="/license">License</a>
  <a href="/privacy">Privacy</a>
</footer>
</body></html>`,
  },
  {
    label: '奇葩链接 corner cases (协议无关 / 大小写 / 尾斜杠 / query)',
    referenceUrl: 'https://nimbus.dev',
    referenceTitle: 'Nimbus Cloud',
    intent: '主色调改成绿色 #16A34A',
    referenceHtml: `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><title>Nimbus Cloud</title>
<style>body{margin:0;font-family:system-ui;color:#0f172a}header{padding:16px 32px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between}nav a{margin-right:20px;color:#475569;text-decoration:none}section{padding:64px 32px;max-width:1000px;margin:0 auto}.btn{padding:12px 24px;background:#7C3AED;color:#fff;border-radius:8px}</style>
</head><body>
<header>
  <a href="/">Nimbus</a>
  <nav>
    <a href="//nimbus.dev/products">Products</a>
    <a href="HTTPS://NIMBUS.DEV/customers">Customers</a>
    <a href="https://nimbus.dev/about/?ref=nav#story">About story</a>
    <a href="docs/">Docs</a>
    <a href="https://nimbus.dev/pricing.html">Pricing</a>
  </nav>
  <a href="/get-started" class="btn">Get started</a>
</header>
<section id="hero">
  <h1>Cloud built for agents.</h1>
  <p>Nimbus runs millions of agent workloads with one API.</p>
  <p><a href="signup.html">Sign up</a> or <a href="https://nimbus.dev/contact?utm_source=hero">contact us</a>.</p>
</section>
<section id="products">
  <h2>Products</h2>
  <ul>
    <li><a href="//nimbus.dev/products/compute">Compute</a></li>
    <li><a href="products/storage/">Storage</a></li>
    <li><a href="https://api.nimbus.dev/docs">API docs (subdomain — external)</a></li>
  </ul>
</section>
<form action="//nimbus.dev/api/leads"><input name="email"/></form>
</body></html>`,
  },
];

console.log(`\n=== Setup (BASE=${BASE}) ===`);
const cookie = await loginAs('xuxinmaxen@deeplumen.com').catch(() => '') || await loginAs('xuxin@deeplumen.com');
console.log(`login cookie: ${cookie ? 'ok' : 'MISSING'}`);
if (!cookie) { console.error('cannot login'); process.exit(1); }

for (let i = 0; i < rounds.length; i++) {
  await runRound(i + 1, rounds[i], cookie);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`User-flow 3-round: ${totalPassed} passed, ${totalFailed} failed`);
console.log('──────────────────────────────────────────────────');
if (totalFailed > 0) {
  console.error('\nFAILURES:');
  for (const f of allFailures) console.error(`  R${f.round} ${f.label}: ${f.detail}`);
  process.exit(1);
}
