/**
 * GET  /api/employees   — 列出当前 owner 的所有员工
 * POST /api/employees   — 创建一个员工
 *   body: { kind, name, role, email?, persona? }
 *   - kind=human: 必须有 name + role, email 选填
 *   - kind=agent: 必须有 name + role + persona
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  listEmployees,
  createEmployee,
  ROLE_OPTIONS,
} from '@/lib/employees';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

const Body = z.object({
  kind: z.enum(['human', 'agent']),
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(20),
  email: z.string().trim().max(120).optional().nullable(),
  persona: z.string().trim().max(2000).optional().nullable(),
  /** 仅 human: 同时创建 AI 替身 (kind=agent, linked_human_id=新真人id) */
  withDigital: z.boolean().optional(),
  /** 仅 human: 创建时是否在线, 默认 true */
  isOnline: z.boolean().optional(),
});

export async function GET() {
  try {
    const employees = await listEmployees(DEMO_OWNER_ID);
    return NextResponse.json({ ok: true, employees, roles: ROLE_OPTIONS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  if (body.kind === 'agent' && !body.persona?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'Agent 必须填写人设' },
      { status: 400 }
    );
  }

  try {
    const result = await createEmployee({
      ownerId: DEMO_OWNER_ID,
      kind: body.kind,
      name: body.name,
      role: body.role,
      email: body.email,
      persona: body.persona,
      withDigital: body.kind === 'human' ? body.withDigital : false,
      isOnline: body.isOnline,
    });
    revalidatePath('/employees');
    return NextResponse.json(
      { ok: true, employee: result.employee, digital: result.digital },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
