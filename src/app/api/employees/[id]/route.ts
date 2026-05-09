/**
 * GET    /api/employees/[id]
 * PATCH  /api/employees/[id]   — kind 不可改, name/role/email/persona 可改
 * DELETE /api/employees/[id]
 *
 * 默认员工 (DEMO_OWNER_ID seed 出来的徐鑫) 不允许删除 — 会破坏 author_id 引用。
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  getEmployee,
  updateEmployee,
  deleteEmployee,
} from '@/lib/employees';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

const Patch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  role: z.string().trim().min(1).max(20).optional(),
  email: z.string().trim().max(120).nullable().optional(),
  persona: z.string().trim().max(2000).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) {
    return NextResponse.json(
      { ok: false, error: 'employee not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, employee });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let patch: z.infer<typeof Patch>;
  try {
    patch = Patch.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const updated = await updateEmployee(id, patch);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: 'employee not found' },
      { status: 404 }
    );
  }
  revalidatePath('/employees');
  return NextResponse.json({ ok: true, employee: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (id === DEMO_OWNER_ID) {
    return NextResponse.json(
      { ok: false, error: '默认员工不可删除' },
      { status: 400 }
    );
  }
  const ok = await deleteEmployee(id);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'employee not found' },
      { status: 404 }
    );
  }
  revalidatePath('/employees');
  return NextResponse.json({ ok: true });
}
