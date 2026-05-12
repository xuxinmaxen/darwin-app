import { cookies } from 'next/headers';
import { db } from './db';
import { getEmployee } from './employees';
import type { Employee } from './employees';

export const COOKIE_NAME = 'darwin_user_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7d

export const DEMO_VERIFICATION_CODE = '123456';

export async function findHumanByEmail(email: string): Promise<Employee | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const { data, error } = await db()
    .from('employees')
    .select('id')
    .eq('kind', 'human')
    .ilike('email', trimmed)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return getEmployee((data as { id: string }).id);
}

export async function currentUser(): Promise<Employee | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id) return null;
  const emp = await getEmployee(id);
  if (!emp || emp.kind !== 'human') return null;
  return emp;
}

export async function setLoginCookie(employeeId: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, employeeId, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearLoginCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * 从 cookie 读取当前登录用户 id.
 * 如果没有登录(cookie 不存在或用户已删)，回退 DEMO_OWNER_ID 保持向后兼容。
 */
export async function currentUserId(): Promise<string> {
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id) return DEMO_OWNER_ID;
  // 轻量验证: 只检查 cookie 值非空, 不查库 (节省 DB 调用)
  return id;
}
