/**
 * /api/intents/[id]
 *
 * DELETE  — remove a single intent
 */

import { NextRequest, NextResponse } from 'next/server';
import { deleteIntent } from '@/lib/intents';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteIntent(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
