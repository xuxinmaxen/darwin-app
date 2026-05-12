'use client';

/**
 * 顶栏主题切换按钮 — 点击在 Light / Dark 之间切换。
 * 主题通过 <html data-theme="dark"> 实现,同时写 localStorage 持久化。
 */

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // 初始化: 读 localStorage 或系统偏好
    const saved = localStorage.getItem('darwin-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : prefersDark;
    setIsDark(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('darwin-theme', next ? 'dark' : 'light');
  }

  return (
    <button
      type="button"
      className={`ctrl theme-toggle-btn${isDark ? ' is-dark' : ''}`}
      onClick={toggle}
      title={isDark ? '切换到浅色模式' : '切换到深色模式'}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
    >
      {isDark ? (
        /* 太阳 */
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <circle cx="7" cy="7" r="2.5" />
          <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.2 3.2l.7.7M10.1 10.1l.7.7M3.2 10.8l.7-.7M10.1 3.9l.7-.7" strokeLinecap="round"/>
        </svg>
      ) : (
        /* 月亮 */
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path d="M11.5 8.5A5.5 5.5 0 0 1 5.5 2.5a5.5 5.5 0 1 0 6 6z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}
