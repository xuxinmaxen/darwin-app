'use client';

/**
 * 顶栏用户头像 + 登出菜单。
 *
 * 点头像展开一个小卡片显示名字 / 岗位 / 登出按钮; 点外面或按 Esc 收起。
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrentUserMini } from './WorkspaceShell';

export default function UserMenu({ user }: { user?: CurrentUserMini }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* 忽略, 反正 cookie 服务端会清 */
    }
    setOpen(false);
    router.push('/login');
    router.refresh();
  }

  // 没登录态: 不展开菜单, 显示一个空 placeholder (实际页面会被服务端重定向到 /login)
  if (!user) {
    return (
      <div className="ws-user">
        <div className="avatar xu" title="未登录">?</div>
      </div>
    );
  }

  return (
    <div className="ws-user-menu" ref={wrapRef}>
      <button
        type="button"
        className="ws-user-trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name} / ${user.role}`}
      >
        <span className={`avatar ${user.cls}`}>{user.short}</span>
      </button>
      {open && (
        <div className="ws-user-pop" role="menu">
          <div className="ws-user-pop-head">
            <span className={`avatar ${user.cls}`}>{user.short}</span>
            <div className="ws-user-pop-text">
              <span className="ws-user-pop-name">{user.name}</span>
              <span className="ws-user-pop-role">{user.role}</span>
            </div>
          </div>
          <button
            type="button"
            className="ws-user-pop-action"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2M9 4l3 3-3 3M5 7h7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {loggingOut ? '登出中…' : '登出'}
          </button>
        </div>
      )}
    </div>
  );
}
