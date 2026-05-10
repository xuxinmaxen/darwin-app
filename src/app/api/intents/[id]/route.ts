/**
 * /api/intents/[id]
 *
 * DELETE  — remove a single intent
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { deleteIntent } from '@/lib/intents';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const removed = await deleteIntent(id);
    revalidatePath('/');
    if (removed) revalidatePath(`/projects/${removed.projectId}`);
    return NextResponse.json({
      ok: true,
      // 客户端可据此 toast "X 个关联冲突已自动撤销"
      staleTensionIds: removed?.staleTensionIds ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
