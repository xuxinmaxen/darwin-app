/**
 * POST /api/import/image
 *
 * Body: multipart/form-data, field "file" = image (jpg/png/gif/webp/svg)
 *
 * 上传图片到 Supabase Storage (darwin-images bucket),返回公开 URL.
 * 如果 Supabase Storage 未配置,返回 base64 data URL 作为降级.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const BUCKET = 'darwin-images';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ ok: false, error: '没有收到文件' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ ok: false, error: `不支持的图片格式: ${file.type}` }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, error: '图片超过 10MB 上限' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // Try Supabase Storage first
    try {
      const { data, error } = await db().storage.from(BUCKET).upload(fileName, bytes, {
        contentType: file.type,
        upsert: false,
      });
      if (!error && data) {
        const { data: urlData } = db().storage.from(BUCKET).getPublicUrl(data.path);
        return NextResponse.json({
          ok: true,
          url: urlData.publicUrl,
          name: file.name,
          type: file.type,
          storage: 'supabase',
        });
      }
    } catch {
      // Storage bucket not configured, fall through to base64
    }

    // Fallback: base64 data URL (works without storage setup)
    const base64 = Buffer.from(bytes).toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;
    return NextResponse.json({
      ok: true,
      url: dataUrl,
      name: file.name,
      type: file.type,
      storage: 'base64',
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
