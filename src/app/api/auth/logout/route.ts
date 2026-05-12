/**
 * POST /api/auth/logout — 清掉 cookie
 */

import { NextResponse } from 'next/server';
import { clearLoginCookie, COOKIE_NAME } from '@/lib/auth';
import { clearLastActive } from '@/lib/employees';
import { cookies } from 'next/headers';

export async function POST() {
  // 在清 cookie 前先把"当前 cookie 标识的用户"标记为下线
  // 必须直接读 cookie 拿到 id, 不能用 currentUserId() — 它在 cookie 缺失时会
  // fallback 到 DEMO_OWNER_ID, 会错误地清掉默认 owner 的状态
  try {
    const jar = await cookies();
    const id = jar.get(COOKIE_NAME)?.value;
    if (id) {
      await clearLastActive(id);
    }
  } catch { /* 忽略 */ }
  await clearLoginCookie();
  return NextResponse.json({ ok: true });
}
