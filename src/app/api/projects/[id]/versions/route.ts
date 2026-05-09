/**
 * GET /api/projects/[id]/versions
 *
 * 返回项目的版本元数据列表 (不含 content,避免 payload 爆掉)。
 * 顺序 ASC: index 0 = v1 (最早), index n-1 = vN (最新)。
 */

import { NextResponse } from 'next/server';
import { listVersionsMetadata } from '@/lib/versions';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const versions = await listVersionsMetadata(id);
    return NextResponse.json({ ok: true, versions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
