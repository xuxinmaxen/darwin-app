/**
 * GET /api/projects/[id]/tensions
 *   - 列出该项目的所有 Tension (active + resolved, 按时间倒序)
 *
 * 检测是 fire-and-forget 触发的, 没有手动 detect endpoint。
 * 客户端读取时只查列表。
 */

import { NextResponse } from 'next/server';
import { listTensions } from '@/lib/tensions';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const tensions = await listTensions(id);
    return NextResponse.json({ ok: true, tensions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
