/**
 * POST /api/import/html
 *
 * Body: { url: string }
 *
 * 服务端抓取 URL 完整 HTML, 返回 sanitize 后的 rawHtml + 纯文本预览 + title。
 *
 * 实际抓取/sanitize 实现在 src/lib/fetch-imported-html.ts (合成路径也用)。
 * 这里只是 HTTP 包装。
 *
 * 限制:
 *   - 仅支持 http(s), 12s 超时
 *   - rawHtml 上限 500KB, text 上限 8000 字
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  FetchImportedHtmlInput,
  fetchImportedHtml,
  FetchImportedHtmlError,
} from '@/lib/fetch-imported-html';

export async function POST(req: NextRequest) {
  let body: ReturnType<typeof FetchImportedHtmlInput.parse>;
  try {
    body = FetchImportedHtmlInput.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  try {
    const result = await fetchImportedHtml(body.url);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof FetchImportedHtmlError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
