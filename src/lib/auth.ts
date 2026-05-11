/**
 * V1 极简登录: 邮箱匹配 employees 表的 human 员工, 验证码默认 123456。
 *
 * 不接第三方 IdP, 不存 hash, 单进程 SQLite 上的演示用方案。
 * Cookie 写 employee.id, server component / route handler 用 currentUser() 取。
 */

import { cookies } from 'next/headers';
import { db } from './db';
import { getEmployee } from './employees';
import type { Employee } from './employees';

export const COOKIE_NAME = 'darwin_user_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7d

/** 演示验证码; 真生产应换 OTP / magic link */
export const DEMO_VERIFICATION_CODE = '123456';

/** 邮箱大小写不敏感, 仅匹配 human 员工; 通过 id 走 getEmployee 拿完整 Employee */
export async function findHumanByEmail(email: string): Promise<Employee | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const row = db()
    .prepare(
      `SELECT id FROM employees
       WHERE kind = 'human' AND LOWER(email) = ?
       LIMIT 1`
    )
    .get(trimmed) as { id: string } | undefined;
  if (!row) return null;
  return getEmployee(row.id);
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
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearLoginCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
