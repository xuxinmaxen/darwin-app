/**
 * Intent[] → 产物 合成器
 *
 * 行为:
 *   1. 默认先试 Claude (走 lib/claude.ts → 当前指向 Hermes)
 *   2. Claude 报错 / 超时 / Hermes 503 → 自动回退本地 template
 *   3. 想强制走 template (省流量调试 UI),设 env DARWIN_DISABLE_CLAUDE=1
 *
 * 这样的好处:Hermes 解锁 / 换原生 Anthropic key 后,无需改代码,
 * dev server 重启一次就直接走 Claude。
 */

import type { Project, Intent } from './types';
import { callLLM, callLLMStream, llmProvider } from './llm';
import {
  buildSynthesizeSystem,
  buildSynthesizeUser,
  buildIncrementalUpdateUser,
  looksLikeValidHtml,
  looksLikeCompleteHtml,
  stripCodeFences,
} from './prompts/synthesize-html';

// ─── SSE event types ──────────────────────────────────────
export type SynthesisEvent =
  | { type: 'thinking'; message: string }
  /** 从 LLM 流出的 HTML 文本片段 */
  | { type: 'chunk'; content: string }
  /** LLM 输出结束 — 包含最终清洗过的完整 HTML（route handler 用来入库） */
  | { type: 'complete'; source: 'llm' | 'template'; mode: 'full' | 'incremental'; html: string }
  /** 版本已入库 — 客户端用来更新 currentVersion 状态 */
  | { type: 'saved'; version: Record<string, unknown>; mode: string }
  | { type: 'error'; message: string };

export type SynthesisResult = {
  content: string;
  source: 'llm' | 'template';
  reason?: string;
  mode?: 'full' | 'incremental';
};

// HTML 8000 token 约 80-100s 生成,留足 margin。可通过 env 调,长时间项目也能用。
const LLM_TIMEOUT_MS = Number(process.env.LLM_SYNTHESIZE_TIMEOUT_MS) || 180_000;

export async function synthesize(
  project: Project,
  intents: Intent[],
  /** 如果传入当前版本 HTML + 已合成的 intentIds，会走增量更新而非完全重生成 */
  existing?: { html: string; intentIds: string[] } | null
): Promise<SynthesisResult> {
  if (process.env.DARWIN_DISABLE_CLAUDE === '1') {
    return {
      content: renderTemplate(project, intents),
      source: 'template',
      reason: 'DARWIN_DISABLE_CLAUDE=1 强制使用本地模板',
      mode: 'full',
    };
  }

  if (!llmProvider()) {
    return {
      content: renderTemplate(project, intents),
      source: 'template',
      reason: '未配置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY,使用本地模板',
      mode: 'full',
    };
  }

  // 增量模式: 有已有版本 + 有新的 intent
  if (existing && existing.html) {
    const prevIds = new Set(existing.intentIds);
    const newIntents = intents.filter(i => !prevIds.has(i.id));

    // 只有新增 intent 才走增量;如果 intent 没变化或全是新的,走全量
    if (newIntents.length > 0 && newIntents.length < intents.length) {
      try {
        const html = await Promise.race([
          callLLMForIncrementalUpdate(project, newIntents, existing.html),
          timeout(LLM_TIMEOUT_MS),
        ]);
        return { content: html, source: 'llm', mode: 'incremental' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn('[synthesize] incremental update failed, falling back to full synthesis:', reason);
        // 降级到全量
      }
    }
  }

  // 全量合成
  try {
    const html = await Promise.race([
      callLLMForHtmlSynthesis(project, intents),
      timeout(LLM_TIMEOUT_MS),
    ]);
    return { content: html, source: 'llm', mode: 'full' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[synthesize] LLM path failed, falling back to template:', reason);
    return {
      content: renderTemplate(project, intents),
      source: 'template',
      reason: `LLM 失败: ${reason.slice(0, 120)}`,
      mode: 'full',
    };
  }
}

// ─── LLM paths ──────────────────────────────────────────────

/**
 * Import-seed 模式 (1:1 复刻) 输出体积 ≈ 源 HTML 大小, 218KB 源页需要 ~64K output tokens。
 * 默认 16K 只够 ~64KB 输出, 大页面必然截断 → 抛错 → 模板兜底。
 * 含 【导入参考 (HTML)】 marker 时, 自动放宽到 64K (env DARWIN_SYNTHESIS_MAX_TOKENS_IMPORT 可覆盖)。
 */
function maxTokensFor(project: Project): number {
  const isImportSeed = (project.background ?? '').includes('【导入参考 (HTML)】');
  if (isImportSeed) {
    return Number(process.env.DARWIN_SYNTHESIS_MAX_TOKENS_IMPORT) || 64000;
  }
  return Number(process.env.DARWIN_SYNTHESIS_MAX_TOKENS) || 16000;
}

async function callLLMForHtmlSynthesis(
  project: Project,
  intents: Intent[]
): Promise<string> {
  const system = buildSynthesizeSystem(project);
  const user = buildSynthesizeUser(intents);

  const raw = await callLLM({
    system,
    user,
    cacheSystem: true,
    maxTokens: maxTokensFor(project),
    temperature: 0.4,
  });

  const cleaned = stripCodeFences(raw);
  if (!looksLikeValidHtml(cleaned)) {
    throw new Error(
      `LLM 返回不是 HTML 文档 (前 100 字符: ${cleaned.slice(0, 100)})`
    );
  }
  if (!looksLikeCompleteHtml(cleaned)) {
    throw new Error(
      `LLM 输出被截断 (${cleaned.length} chars, 无 </html>) — 调大 DARWIN_SYNTHESIS_MAX_TOKENS`
    );
  }
  return cleaned;
}

async function callLLMForIncrementalUpdate(
  project: Project,
  newIntents: Intent[],
  existingHtml: string
): Promise<string> {
  const system = buildSynthesizeSystem(project);
  const user = buildIncrementalUpdateUser(newIntents, existingHtml);

  const raw = await callLLM({
    system,
    user,
    cacheSystem: true,
    maxTokens: maxTokensFor(project),
    temperature: 0.2,  // 更低温度 → 更保守地修改
  });

  const cleaned = stripCodeFences(raw);
  if (!looksLikeValidHtml(cleaned)) {
    throw new Error(
      `LLM 增量更新返回不是 HTML (前 100 字符: ${cleaned.slice(0, 100)})`
    );
  }
  if (!looksLikeCompleteHtml(cleaned)) {
    throw new Error(
      `LLM 增量更新被截断 (${cleaned.length} chars, 无 </html>)`
    );
  }
  return cleaned;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Claude 调用超时 ${ms}ms`)), ms)
  );
}

// ─── Streaming synthesis ─────────────────────────────────
// 每个 SynthesisEvent 通过 AsyncGenerator yield 出来,
// route handler 把它们编码成 SSE 并 flush 到客户端。

export async function* synthesizeStream(
  project: Project,
  intents: Intent[],
  existing?: { html: string; intentIds: string[] } | null
): AsyncGenerator<SynthesisEvent> {
  // 模板模式 / 无 LLM 时: 快速返回整块 HTML
  if (process.env.DARWIN_DISABLE_CLAUDE === '1' || !llmProvider()) {
    yield { type: 'thinking', message: '使用本地模板合成…' };
    const html = renderTemplate(project, intents);
    yield { type: 'chunk', content: html };
    yield { type: 'complete', source: 'template', mode: 'full', html };
    return;
  }

  // 含导入参考 (HTML) 的项目走 1:1 复刻, 输出体积接近源 HTML, 需要更大 maxTokens
  const maxTokens = maxTokensFor(project);

  // 增量更新路径
  if (existing?.html) {
    const prevIds = new Set(existing.intentIds);
    const newIntents = intents.filter(i => !prevIds.has(i.id));
    if (newIntents.length > 0 && newIntents.length < intents.length) {
      yield { type: 'thinking', message: `AI 正在把 ${newIntents.length} 条新意图融入产物…` };
      try {
        let html = '';
        let fenceState: 'unknown' | 'stripped' | 'plain' = 'unknown';
        let fenceBuffer = '';
        for await (const chunk of callLLMStream({
          system: buildSynthesizeSystem(project),
          user: buildIncrementalUpdateUser(newIntents, existing.html),
          cacheSystem: true,
          maxTokens,
          temperature: 0.2,
        })) {
          // 剥 ```html 代码围栏 (流式版本)
          if (fenceState === 'unknown') {
            fenceBuffer += chunk;
            if (fenceBuffer.length >= 20) {
              fenceState = fenceBuffer.trimStart().startsWith('```') ? 'stripped' : 'plain';
              const stripped = fenceState === 'stripped'
                ? fenceBuffer.replace(/^```(?:html)?\s*\n?/i, '')
                : fenceBuffer;
              html += stripped;
              yield { type: 'chunk', content: stripped };
              fenceBuffer = '';
            }
          } else {
            html += chunk;
            yield { type: 'chunk', content: chunk };
          }
        }
        // 处理未 flush 的 fence buffer
        if (fenceBuffer) {
          const stripped = fenceState === 'stripped'
            ? fenceBuffer.replace(/^```(?:html)?\s*\n?/i, '')
            : fenceBuffer;
          html += stripped;
          yield { type: 'chunk', content: stripped };
        }
        html = stripCodeFences(html);
        if (!looksLikeValidHtml(html)) throw new Error('LLM 增量更新返回不是 HTML');
        if (!looksLikeCompleteHtml(html)) {
          // LLM 输出在 </html> 之前被 maxTokens 截断 — 渲染会半截.
          // 主动抛错让上层 fall through 到全量重试 (有更大 token budget) 或模板兜底.
          throw new Error(`LLM 增量更新被截断 (${html.length} chars, 无 </html>) — 提示 maxTokens 不够`);
        }
        yield { type: 'complete', source: 'llm', mode: 'incremental', html };
        return;
      } catch (err) {
        yield { type: 'thinking', message: '增量更新失败,切换全量合成…' };
        // fall through to full synthesis
      }
    }
  }

  // 全量合成路径
  const intentWord = intents.length === 1 ? '条意图' : `条意图`;
  yield { type: 'thinking', message: `AI 正在综合 ${intents.length} ${intentWord},合成完整产物…` };

  // 导入模式 (background 含【导入参考 (HTML)】) → 强保真复刻, temp 调到 0.15
  // 普通新建 → 允许 LLM 发挥, temp 0.4
  const isImportSeed = (project.background ?? '').includes('【导入参考 (HTML)】');
  const fullTemperature = isImportSeed ? 0.15 : 0.4;

  try {
    let html = '';
    let fenceState: 'unknown' | 'stripped' | 'plain' = 'unknown';
    let fenceBuffer = '';

    for await (const chunk of callLLMStream({
      system: buildSynthesizeSystem(project),
      user: buildSynthesizeUser(intents),
      cacheSystem: true,
      maxTokens,
      temperature: fullTemperature,
    })) {
      if (fenceState === 'unknown') {
        fenceBuffer += chunk;
        if (fenceBuffer.length >= 20) {
          fenceState = fenceBuffer.trimStart().startsWith('```') ? 'stripped' : 'plain';
          const stripped = fenceState === 'stripped'
            ? fenceBuffer.replace(/^```(?:html)?\s*\n?/i, '')
            : fenceBuffer;
          html += stripped;
          yield { type: 'chunk', content: stripped };
          fenceBuffer = '';
        }
      } else {
        html += chunk;
        yield { type: 'chunk', content: chunk };
      }
    }
    if (fenceBuffer) {
      const stripped = fenceState === 'stripped'
        ? fenceBuffer.replace(/^```(?:html)?\s*\n?/i, '')
        : fenceBuffer;
      html += stripped;
      yield { type: 'chunk', content: stripped };
    }
    html = stripCodeFences(html);
    if (!looksLikeValidHtml(html)) {
      throw new Error(`LLM 返回不是 HTML (前 100 字符: ${html.slice(0, 100)})`);
    }
    if (!looksLikeCompleteHtml(html)) {
      // 截断保护: 不让半截 HTML 入库
      throw new Error(`LLM 全量合成被 maxTokens 截断 (${html.length} chars, 无 </html>) — 请调大 DARWIN_SYNTHESIS_MAX_TOKENS`);
    }
    yield { type: 'complete', source: 'llm', mode: 'full', html };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'thinking', message: `LLM 失败,使用模板兜底: ${msg.slice(0, 80)}` };
    const html = renderTemplate(project, intents);
    yield { type: 'chunk', content: html };
    yield { type: 'complete', source: 'template', mode: 'full', html };
  }
}

// ─── Template fallback ────────────────────────────────────

function renderTemplate(project: Project, intents: Intent[]): string {
  if (project.type === 'html') return renderHtml(project, intents);
  return renderMarkdown(project, intents);
}

function renderHtml(project: Project, intents: Intent[]): string {
  const goals = intents.filter(i => i.type === 'Goal');
  const constraints = intents.filter(
    i => i.type === 'Constraint' || i.type === 'Veto'
  );
  const preferences = intents.filter(i => i.type === 'Preference');

  const heroTitle = project.name;
  const heroSub =
    goals[0]?.statement ||
    project.background ||
    `由 ${intents.length} 条 Intent 合成的页面`;

  const featureCards = goals
    .slice(1, 7)
    .map(
      (g, idx) => `
      <article class="feature">
        <div class="feat-num">0${idx + 1}</div>
        <p class="feat-text">${escapeHtml(g.statement)}</p>
      </article>`
    )
    .join('');

  const promiseList = constraints
    .map(c => `<li>${escapeHtml(c.statement)}</li>`)
    .join('');

  const prefList = preferences
    .map(p => `<li>${escapeHtml(p.statement)}</li>`)
    .join('');

  const generatedAt = new Date().toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.name)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",sans-serif;background:#FAF9F5;color:#1A1A1C;line-height:1.55;-webkit-font-smoothing:antialiased}
  .frame{max-width:1080px;margin:0 auto;background:#fff;box-shadow:0 0 0 1px #E8E5DA, 0 16px 48px rgba(20,20,30,.06)}
  .hero{padding:80px 60px 64px;background:radial-gradient(ellipse 80% 90% at 100% 0%,rgba(79,70,229,.10),transparent 60%),radial-gradient(ellipse 80% 90% at 0% 100%,rgba(124,58,237,.06),transparent 60%);border-bottom:1px solid #E8E5DA}
  .eyebrow{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;background:#fff;color:#3730A3;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-bottom:18px;border:1px solid #DEE2FF}
  .eyebrow::before{content:"";width:5px;height:5px;border-radius:50%;background:#4F46E5}
  h1{font-size:44px;line-height:1.1;letter-spacing:-.025em;margin:0 0 18px;font-weight:700}
  .sub{font-size:17px;color:#525560;max-width:600px;margin:0 0 32px;line-height:1.6}
  .actions{display:flex;gap:10px;flex-wrap:wrap}
  .btn{padding:12px 22px;border-radius:9px;font-size:14px;font-weight:500;cursor:pointer;border:0;font-family:inherit;letter-spacing:-.005em;transition:transform .15s}
  .btn:hover{transform:translateY(-1px)}
  .btn-p{background:#1A1A1C;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.1)}
  .btn-g{background:transparent;border:1px solid #D8D5C8;color:#525560;box-shadow:0 1px 2px rgba(20,20,30,.03)}
  .features{padding:64px 60px;border-bottom:1px solid #E8E5DA}
  .section-eyebrow{font-size:11px;color:#8E8F99;letter-spacing:.12em;text-transform:uppercase;margin-bottom:28px;font-weight:600}
  .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .feature{padding:24px;border:1px solid #E8E5DA;border-radius:14px;background:#FAFAFA;transition:transform .2s,box-shadow .2s}
  .feature:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(20,20,30,.06)}
  .feat-num{font-size:11px;color:#4F46E5;font-weight:700;letter-spacing:.08em;margin-bottom:10px;font-family:ui-monospace,Menlo,monospace}
  .feat-text{margin:0;font-size:14px;color:#1A1A1C;line-height:1.55}
  .promises,.prefs{padding:48px 60px;background:#F7F6F0;border-bottom:1px solid #E8E5DA}
  .prefs{background:#fff}
  .promises h2,.prefs h2{font-size:20px;letter-spacing:-.015em;margin:0 0 14px}
  .promises ul,.prefs ul{padding-left:22px;color:#525560;font-size:14px;margin:0}
  .promises li,.prefs li{margin-bottom:6px;line-height:1.6}
  .cta{padding:80px 60px;text-align:center}
  .cta h2{font-size:30px;letter-spacing:-.02em;margin:0 0 12px;font-weight:700}
  .cta-sub{color:#525560;margin:0 0 24px;font-size:14.5px}
  .meta{padding:20px 60px;color:#8E8F99;font-size:11px;text-align:center;background:#F4F2EA;border-top:1px solid #E8E5DA;font-family:ui-monospace,Menlo,monospace}
</style>
</head>
<body>
  <div class="frame">
    <section class="hero" data-scope="hero">
      <div class="eyebrow">${escapeHtml(project.name)}</div>
      <h1>${escapeHtml(heroTitle)}</h1>
      <p class="sub">${escapeHtml(heroSub)}</p>
      <div class="actions">
        <button class="btn btn-p">立即试用 →</button>
        <button class="btn btn-g">观看演示</button>
      </div>
    </section>
    ${
      featureCards
        ? `<section class="features" data-scope="features"><div class="section-eyebrow">核心能力</div><div class="features-grid">${featureCards}</div></section>`
        : ''
    }
    ${
      promiseList
        ? `<section class="promises" data-scope="footer"><h2>我们的承诺</h2><ul>${promiseList}</ul></section>`
        : ''
    }
    ${
      prefList
        ? `<section class="prefs" data-scope="features"><h2>设计偏好</h2><ul>${prefList}</ul></section>`
        : ''
    }
    <section class="cta" data-scope="cta">
      <h2>准备好开始了吗？</h2>
      <p class="cta-sub">由 ${intents.length} 条 Intent 合成 · ${generatedAt}</p>
      <button class="btn btn-p">免费开始 →</button>
    </section>
    <div class="meta">
      Darwin 模板合成 · ${intents.length} intents · ${generatedAt} · Claude 解锁后会换成 LLM 直出
    </div>
  </div>
</body>
</html>`;
}

function renderMarkdown(project: Project, intents: Intent[]): string {
  const lines: string[] = [];
  const generatedAt = new Date().toLocaleString('zh-CN');

  lines.push(`# ${project.name}\n`);
  if (project.background) lines.push(`> ${project.background}\n`);

  const grouped: Record<string, Intent[]> = {
    Goal: [],
    Constraint: [],
    Preference: [],
    Reference: [],
    Veto: [],
  };
  for (const i of intents) grouped[i.type]?.push(i);

  if (grouped.Goal.length > 0) {
    lines.push(`## 目标\n`);
    for (const i of grouped.Goal)
      lines.push(`- **${i.scope}** (${i.weight}): ${i.statement}`);
    lines.push('');
  }
  if (grouped.Constraint.length > 0 || grouped.Veto.length > 0) {
    lines.push(`## 约束 / 红线\n`);
    for (const i of [...grouped.Constraint, ...grouped.Veto])
      lines.push(`- **${i.type}** [${i.scope}]: ${i.statement}`);
    lines.push('');
  }
  if (grouped.Preference.length > 0) {
    lines.push(`## 偏好\n`);
    for (const i of grouped.Preference)
      lines.push(`- ${i.statement}`);
    lines.push('');
  }
  if (grouped.Reference.length > 0) {
    lines.push(`## 参考\n`);
    for (const i of grouped.Reference) lines.push(`- ${i.statement}`);
    lines.push('');
  }

  lines.push(
    `\n---\n\n*合成于 ${generatedAt} · ${intents.length} intents · template fallback*`
  );
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
