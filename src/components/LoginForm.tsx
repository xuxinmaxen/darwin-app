'use client';

/**
 * 登录表单 — 邮箱 + 6 位验证码。
 *
 * 验证码默认 123456 (lib/auth.ts DEMO_VERIFICATION_CODE)。
 * 邮箱要匹配员工管理里 kind='human' 的员工。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      // 服务端异常时 body 可能为空, 不能让 res.json() 直接抛 "Unexpected end of JSON input"
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || `服务暂时不可用 (${res.status}),请稍后重试`);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-logo" aria-hidden />
          <div className="login-brand-text">
            <span className="brand-name">Darwin</span>
            <span className="brand-tagline">组织的每一次共识，即是每一次进化。</span>
          </div>
        </div>

        <h1 className="login-title">登录</h1>
        <p className="login-sub">用员工邮箱进来,一起把意图合成为产物。</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-field">
            <span className="login-label">邮箱</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
            />
          </label>

          <label className="login-field">
            <span className="login-label">
              验证码
              <span className="login-label-hint">演示版默认 123456</span>
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="6 位数字"
              required
            />
          </label>

          {error && <div className="login-error">⚠️ {error}</div>}

          <button
            type="submit"
            className="login-submit"
            disabled={submitting || !email.trim() || !code.trim()}
          >
            {submitting ? '登录中…' : '进入工作台 →'}
          </button>
        </form>

        <div className="login-foot">
          没有账号? 让管理员把你加进
          <a href="/employees" className="login-foot-link"> 员工管理</a>。
        </div>
      </div>
    </div>
  );
}
