/**
 * POST /api/projects/[id]/versions/[v]/rollback
 *
 * 一键回滚: 把目标 version 复制成一条新 version (作为最新)。
 * 历史不动,行为可观测,不会真的删除任何东西。
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { rollbackTo } from '@/lib/versions';

type Params = { params: Promise<{ id: string; v: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id, v } = await params;
  try {
    const version = await rollbackTo(id, v);
    revalidatePath(`/projects/${id}`);
    return NextResponse.json({ ok: true, version }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
