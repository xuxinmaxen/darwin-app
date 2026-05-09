/**
 * GET /api/projects/[id]/versions/[v]
 *
 * 返回单个 version 的完整内容 (含 content),用于"预览旧版本"场景。
 * 路径里的 [v] 是 version 的 id (UUID),不是版本号 vN。
 */

import { NextResponse } from 'next/server';
import { getVersionById } from '@/lib/versions';

type Params = { params: Promise<{ id: string; v: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, v } = await params;
  try {
    const version = await getVersionById(v);
    if (!version || version.projectId !== id) {
      return NextResponse.json(
        { ok: false, error: 'version not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, version });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
