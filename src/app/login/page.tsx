/**
 * 登录页 — Server Component。
 * 已登录直接跳工作台; 否则渲染 LoginForm (Client)。
 */

import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect('/');
  return <LoginForm />;
}
