/**
 * POST /api/import/html
 *
 * Body: { url: string }
 *
 * 服务端拉 URL 内容, 提取可见文本 (去 script/style/HTML tags),
 * 返回给客户端作为新建项目时的"参考底稿"。
 *
 * 不存盘 — 调用方拿到 text 后自己决定塞到哪里 (一般是 project.background)。
 *
 * 限制:
 *   - 仅支持 http(s)
 *   - 单次请求 8s 超时
 *   - 抽取后内容截断到 8000 字 (再多 LLM 也读不完)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const Body = z.object({
  url: z.string().url(),
});

const FETCH_TIMEOUT_MS = 8_000;
const MAX_TEXT_CHARS = 8_000;

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

  // 极简 HTML → text: 去 script/style 块 + 去标签 + 折叠空白
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

  // 提取标题 (best-effort)
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;

  return NextResponse.json({
    ok: true,
    url: body.url,
    title,
    contentType,
    text,
    truncated,
    chars: text.length,
  });
}
