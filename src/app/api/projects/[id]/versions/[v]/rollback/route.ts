/**
 * POST /api/projects/[id]/versions/[v]/rollback
 *
 * 一键回滚: 把目标 version 复制成一条新 version (作为最新)。
 * 历史不动,行为可观测,不会真的删除任何东西。
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { rollbackTo } from '@/lib/versions';
import { listIntentsByProject } from '@/lib/intents';

type Params = { params: Promise<{ id: string; v: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id, v } = await params;
  try {
    // 拉当前 intent 集 → 新版本 intent_ids 与之对齐, 防止 auto-sync 觉得"陈旧"立刻又触发
    const intents = await listIntentsByProject(id);
    const version = await rollbackTo(id, v, intents.map(i => i.id));
    revalidatePath(`/projects/${id}`);
    return NextResponse.json({ ok: true, version }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
