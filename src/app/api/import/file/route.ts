/**
 * POST /api/import/file   (multipart/form-data)
 *
 * Form field: file
 *
 * 文本类文件 (text/*, json, html, md, csv) → 提取内容截到 8000 字返回
 * 其它 (二进制, 例如 .pptx) → 只返 name/size, 提示 "AI 暂时只能读到文件名"
 *
 * 用于"新建项目时导入已有文件"场景。
 */

import { NextRequest, NextResponse } from 'next/server';

const MAX_TEXT_CHARS = 8_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.json', '.xml', '.yaml', '.yml'];

function isTextFile(name: string, mime: string): boolean {
  if (TEXT_MIME_PREFIXES.some(p => mime.startsWith(p))) return true;
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '上传格式不对' },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: '未收到文件 — form 字段名应为 file' },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 上限` },
      { status: 413 }
    );
  }

  const mime = file.type || '';
  const isText = isTextFile(file.name, mime);

  if (!isText) {
    // 二进制 (例如 .pptx) 暂不解析正文, 只返回元信息 + 引导
    return NextResponse.json({
      ok: true,
      name: file.name,
      size: file.size,
      mime: mime || 'application/octet-stream',
      isText: false,
      note: `${file.name} 已记录为参考,但当前 AI 暂未解析二进制文件正文。`,
    });
  }

  let raw = await file.text();

  // 如果是 HTML 文件, 像 import/html 那样剥干净
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm') || mime.includes('html')) {
    raw = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const truncated = raw.length > MAX_TEXT_CHARS;
  const text = truncated ? raw.slice(0, MAX_TEXT_CHARS) + '…' : raw;

  return NextResponse.json({
    ok: true,
    name: file.name,
    size: file.size,
    mime: mime || 'text/plain',
    isText: true,
    text,
    truncated,
    chars: text.length,
  });
}
