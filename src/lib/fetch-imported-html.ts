/**
 * 抓取 URL 完整 HTML, sanitize 后返回 — 给"导入参考"路径用。
 *
 * 两处调用:
 *   1. /api/import/html route (UI 触发, 但当前 NewProjectButton 不再调用 —— 留作以后扩展)
 *   2. /api/projects/[id]/synthesize 路径 (创建项目时只存 URL, 合成时这里 fetch)
 *
 * Sanitize 策略 (intentionally lenient about inline scripts):
 *   - 剥外联 `<script src="...">` — 防加载 untrusted 远端代码
 *   - 保留 inline `<script>...</script>` — 这是原页动效的载体, 不能丢
 *   - 剥 `<iframe>` — 防嵌套
 *   - 剥 onXX="..." 内联事件 — 走 inline script 更可控
 *   - `javascript:` URL 都改成 "#"
 *
 * iframe sandbox 加 allow-scripts 后 inline script 能跑, 是导入页动效活过来的关键一环。
 */
import { z } from 'zod';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 8_000;
const MAX_RAW_HTML_BYTES = 500_000;

/**
 * 给 LLM prompt 用的体积上限。原始 HTML 可能上百万字符,
 * 但 250KB 已经够 Claude/GPT 看到完整 head + 主结构, 同时 200k token 上下文不会爆。
 */
// 500KB 上限 — 对齐客户端本地文件上限 + 服务端 fetch 上限。
// Claude/GPT context 200K token (≈ 600KB chars) 装得下, 不需要更激进的 250K cap。
// import-seed v1 路径下根本不进 LLM, 这个 budget 只对 v2+ 增量合成的 LLM prompt 起兜底作用。
export const REFERENCE_HTML_PROMPT_BUDGET = 500_000;

export const REF_MARKER_OPEN = '【导入参考 (HTML)】';
export const REF_MARKER_CLOSE = '【/导入参考 (HTML)】';
/** "URL-only" marker 内嵌占位符: 合成 route 看到这一行就知道要 lazy-fetch */
export const REF_LAZY_PLACEHOLDER = '原始 HTML: (将在首次合成时自动拉取)';

/**
 * 把抓到的 rawHtml 压缩 (可选) + 截到 budget 内:
 * - 折叠"标签之间"的纯空白 (不动 <pre>/<textarea> 等内部)
 * - 超 budget 时取头 75% + 尾 25%, 中间省略
 *
 * 注: base64 data URI 不再剥离 — 用户能传上来的 HTML 已经被 500KB 上限 cap 住,
 * 把 base64 图片换成 placeholder 会让 1:1 复刻路径下的图片显示不出。LLM 上下文窗
 * 大模型够吞, 真撑爆再说 (在 condense 末尾会按 budget 截断兜底)。
 */
export function condenseReferenceHtml(raw: string): string {
  let s = raw;
  s = s.replace(/>\s{2,}</g, '> <');
  s = s.replace(/\n{3,}/g, '\n\n');
  if (s.length <= REFERENCE_HTML_PROMPT_BUDGET) return s;
  const head = Math.floor(REFERENCE_HTML_PROMPT_BUDGET * 0.75);
  const tail = REFERENCE_HTML_PROMPT_BUDGET - head;
  return s.slice(0, head) +
    '\n<!-- ...(reference html truncated, middle skipped)... -->\n' +
    s.slice(s.length - tail);
}

/**
 * 把 sourceUrl + title + rawHtml 拼成 background marker block。
 * 合成 prompt 看到 marker 会按"复刻蓝本"路径处理。
 */
export function buildReferenceBlock(opts: {
  url?: string | null;
  title?: string | null;
  html: string;
}): string {
  const condensed = condenseReferenceHtml(opts.html);
  const meta = [
    opts.url ? `来源: ${opts.url}` : '',
    opts.title ? `标题: ${opts.title}` : '',
  ].filter(Boolean).join('\n');
  return [
    REF_MARKER_OPEN,
    meta,
    '',
    '原始 HTML (压缩):',
    condensed,
    REF_MARKER_CLOSE,
  ].filter(Boolean).join('\n');
}

/**
 * 从 background marker 抽 lazy-fetch URL。
 * 仅当 marker block 内含 REF_LAZY_PLACEHOLDER (没真正抓取过) 时返回 URL,
 * 否则返回 null (说明 HTML 已经在 marker 里, 不需要再抓)。
 */
export function extractLazyReferenceUrl(background: string | null | undefined): string | null {
  if (!background) return null;
  const blockMatch = background.match(
    new RegExp(
      `${escapeRegex(REF_MARKER_OPEN)}[\\s\\S]*?${escapeRegex(REF_MARKER_CLOSE)}`
    )
  );
  if (!blockMatch) return null;
  const block = blockMatch[0];
  if (!block.includes(REF_LAZY_PLACEHOLDER)) return null;
  const urlMatch = block.match(/来源:\s*(\S+)/);
  return urlMatch ? urlMatch[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 抽出 background marker 里的原始 HTML 正文 (在 "原始 HTML (压缩):" 之后到 marker 关闭之间)。
 * Import-seed 首次合成时, 直接拿这份 HTML 当 v1 — 不走 LLM 复述, 因为源就是 1:1 副本。
 *
 * 返回 null 时:
 *   - background 里没 marker
 *   - marker 里是 REF_LAZY_PLACEHOLDER (URL 还没 hydrate)
 *   - 找不到 "原始 HTML" 段
 */
export function extractReferenceHtmlFromBackground(background: string | null | undefined): string | null {
  if (!background) return null;
  const blockMatch = background.match(
    new RegExp(`${escapeRegex(REF_MARKER_OPEN)}[\\s\\S]*?${escapeRegex(REF_MARKER_CLOSE)}`)
  );
  if (!blockMatch) return null;
  const block = blockMatch[0];
  if (block.includes(REF_LAZY_PLACEHOLDER)) return null;

  const htmlStart = block.indexOf('原始 HTML (压缩):');
  if (htmlStart < 0) return null;
  // 跳到该标签所在行的下一个换行后, 取到 marker close 前的全部内容
  const afterLabel = block.indexOf('\n', htmlStart);
  if (afterLabel < 0) return null;
  const closeIdx = block.lastIndexOf(REF_MARKER_CLOSE);
  if (closeIdx <= afterLabel) return null;
  const html = block.slice(afterLabel + 1, closeIdx).trim();
  if (!html) return null;
  // 至少看起来像 HTML
  const head = html.slice(0, 200).toLowerCase();
  if (!head.includes('<html') && !head.includes('<!doctype') && !head.includes('<body')) return null;
  return html;
}

export const FetchImportedHtmlInput = z.object({
  url: z.string().url(),
});

export type FetchImportedHtmlResult = {
  url: string;
  title: string | null;
  contentType: string | null;
  /** 纯文本预览, 给 LLM 上下文用 */
  text: string;
  truncated: boolean;
  chars: number;
  /** sanitize 后的完整 HTML */
  rawHtml: string;
  rawHtmlBytes: number;
  rawHtmlTruncated: boolean;
};

export class FetchImportedHtmlError extends Error {
  constructor(public readonly status: number, msg: string) {
    super(msg);
    this.name = 'FetchImportedHtmlError';
  }
}

/** 在 <head> 注入 <base href> — 让相对资源 (<img/link/style>) 解析回原域 */
function injectBase(html: string, sourceUrl: string): string {
  const tag = `<base href="${escapeAttr(sourceUrl)}">`;
  if (/<base\b/i.test(html)) {
    return html.replace(/<base\b[^>]*>/i, tag);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return `<head>${tag}</head>${html}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Sanitize HTML for safe iframe rendering.
 *
 * 保留 inline `<script>` 段 (动效需要), 剥危险源:
 *   - 外联 `<script src=...>` (untrusted 远端)
 *   - `<iframe>` (嵌套)
 *   - onXXX inline event handlers
 *   - javascript: URLs
 */
export function sanitizeHtmlPreserveAnimations(html: string): string {
  return html
    // 剥外联 <script src="..."> 但保留 inline <script>...</script>
    .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*\/?>/gi, '')
    // 剥 iframe
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?>/gi, '')
    // 剥内联事件 (onclick / onload / ...) — inline script 段更可控
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    // javascript: URL → #
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
}

/**
 * 抓 URL 完整 HTML + sanitize + 提取 title/text。
 * 失败时抛 FetchImportedHtmlError (.status 给 HTTP route 转 NextResponse 用)。
 */
export async function fetchImportedHtml(url: string): Promise<FetchImportedHtmlResult> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchImportedHtmlError(400, '仅支持 http / https URL');
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  let contentType: string | null = null;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (DarwinImporter/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      throw new FetchImportedHtmlError(502, `远端返回 ${res.status}`);
    }
    contentType = res.headers.get('content-type');
    html = await res.text();
  } catch (err) {
    if (err instanceof FetchImportedHtmlError) throw err;
    throw new FetchImportedHtmlError(
      502,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(t);
  }

  // 提取标题 (best-effort) — 在 sanitize 前, 避免被 <script> 剥规则误伤
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;

  // 纯文本预览
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const truncated = cleaned.length > MAX_TEXT_CHARS;
  const text = truncated ? cleaned.slice(0, MAX_TEXT_CHARS) + '…' : cleaned;

  let rawHtml = sanitizeHtmlPreserveAnimations(html);
  rawHtml = injectBase(rawHtml, url);
  const rawHtmlTruncated = rawHtml.length > MAX_RAW_HTML_BYTES;
  if (rawHtmlTruncated) rawHtml = rawHtml.slice(0, MAX_RAW_HTML_BYTES);

  return {
    url,
    title,
    contentType,
    text,
    truncated,
    chars: text.length,
    rawHtml,
    rawHtmlBytes: rawHtml.length,
    rawHtmlTruncated,
  };
}
