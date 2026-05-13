/**
 * POST /api/import/html
 *
 * Body: { url: string }
 *
 * 服务端抓取 URL 完整 HTML, 返回:
 *   - rawHtml: 注入 <base href> 后的原始 HTML (剥掉 <script> 防 XSS), 用作 v1 种子
 *   - text:    剥纯文本预览 (供 LLM 在增量更新时理解上下文)
 *   - title:   <title> 内容,用于种子意图文案
 *
 * 限制:
 *   - 仅支持 http(s), 8s 超时
 *   - rawHtml 上限 500KB, text 上限 8000 字
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const Body = z.object({
  url: z.string().url(),
});

const FETCH_TIMEOUT_MS = 8_000;
const MAX_TEXT_CHARS = 8_000;
const MAX_RAW_HTML_BYTES = 500_000;

/** 在 <head> 注入 <base href + target> — 让相对资源路径解析到原始域、链接默认新窗口打开 */
function injectBase(html: string, sourceUrl: string): string {
  const tag = `<base href="${escapeAttr(sourceUrl)}" target="_blank">`;
  if (/<base\b/i.test(html)) {
    // 已存在 <base>, 替换 (避免重复)
    return html.replace(/<base\b[^>]*>/i, tag);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  // 没 head, 简单 wrap
  return `<head>${tag}</head>${html}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 剥掉 script/iframe/onXXX 属性 — 安全防线 (iframe 还有 sandbox 兜底) */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    // 移除内联事件 (onclick, onload, ...) 防 XSS
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    // 移除 javascript: URL
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  // 拒绝非 http/https
  const u = new URL(body.url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return NextResponse.json(
      { ok: false, error: '仅支持 http / https URL' },
      { status: 400 }
    );
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  let contentType: string | null = null;
  try {
    const res = await fetch(body.url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (DarwinImporter/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `远端返回 ${res.status}` },
        { status: 502 }
      );
    }
    contentType = res.headers.get('content-type');
    html = await res.text();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  } finally {
    clearTimeout(t);
  }

  // 提取标题 (best-effort) — 在 sanitize 前抓,避免被剥
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;

  // 极简 HTML → text 预览: 给 LLM 增量更新做 context (rawHtml 也会一起送过去)
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

  // 原始 HTML — sanitize 后注入 base, 限制 500KB
  let rawHtml = sanitizeHtml(html);
  rawHtml = injectBase(rawHtml, body.url);
  const rawHtmlTruncated = rawHtml.length > MAX_RAW_HTML_BYTES;
  if (rawHtmlTruncated) rawHtml = rawHtml.slice(0, MAX_RAW_HTML_BYTES);

  return NextResponse.json({
    ok: true,
    url: body.url,
    title,
    contentType,
    text,
    truncated,
    chars: text.length,
    rawHtml,
    rawHtmlBytes: rawHtml.length,
    rawHtmlTruncated,
  });
}
