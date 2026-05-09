/**
 * GET  /api/projects/:id/threads        — 列项目所有 thread
 * POST /api/projects/:id/threads        — 创建 thread
 *   body: { scope, title, tensionId?, openingMessages? }
 *
 * Tension 触发的 thread 走"创建一次性"语义: 同一 tension 已有 active thread 则返回它。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  listThreads,
  createThread,
  findThreadByTension,
} from '@/lib/threads';

const Body = z.object({
  scope: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  tensionId: z.string().nullable().optional(),
  openingMessages: z
    .array(
      z.object({
        authorId: z.string(),
        authorKind: z.enum(['human', 'agent', 'system']),
        body: z.string().min(1).max(2000),
        isDecision: z.boolean().optional(),
      })
    )
    .optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const threads = await listThreads(id);
    return NextResponse.json({ ok: true, threads });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  // tension 一次性: 同 tension 已有 active thread → 复用
  if (body.tensionId) {
    const existing = await findThreadByTension(body.tensionId);
    if (existing) {
      return NextResponse.json(
        { ok: true, thread: existing, reused: true },
        { status: 200 }
      );
    }
  }

  try {
    const thread = await createThread({
      projectId,
      scope: body.scope,
      title: body.title,
      tensionId: body.tensionId ?? null,
      openingMessages: body.openingMessages,
    });
    revalidatePath(`/projects/${projectId}`);
    return NextResponse.json({ ok: true, thread }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
