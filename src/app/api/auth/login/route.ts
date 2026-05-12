/**
 * POST /api/auth/login
 *
 * Body: { email: string, code: string }
 *
 * - 邮箱必须能匹配到一个 human 员工
 * - code 必须等于 DEMO_VERIFICATION_CODE (123456)
 * - 通过则写 cookie, 返回 { ok, user }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  findHumanByEmail,
  setLoginCookie,
  DEMO_VERIFICATION_CODE,
} from '@/lib/auth';
import { bumpLastActive } from '@/lib/employees';

const BodySchema = z.object({
  email: z.string().email('请输入合法的邮箱').max(200),
  code: z.string().min(1, '请输入验证码').max(20),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '参数错误' },
      { status: 400 }
    );
  }

  if (body.code !== DEMO_VERIFICATION_CODE) {
    return NextResponse.json(
      { ok: false, error: '验证码不对' },
      { status: 401 }
    );
  }

  const emp = await findHumanByEmail(body.email);
  if (!emp) {
    return NextResponse.json(
      { ok: false, error: '这个邮箱不在团队成员里' },
      { status: 404 }
    );
  }

  await setLoginCookie(emp.id);
  await bumpLastActive(emp.id); // 标记本次登录, 立刻进入在线状态
  return NextResponse.json({
    ok: true,
    user: {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      email: emp.email,
      short: emp.short,
      cls: emp.cls,
    },
  });
}
