'use client';

/**
 * Heartbeat — 每 60 秒往 /api/auth/heartbeat 打一次,告诉服务端用户还在线。
 * 页面可见时才打,后台或最小化时停。
 * 离开页面 (logout 路径除外) 时不主动通知后端;由 last_active_at 在 90 秒后自然过期。
 */

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 60_000;

export default function Heartbeat() {
  useEffect(() => {
    let cancelled = false;

    function ping() {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      fetch('/api/auth/heartbeat', { method: 'POST' }).catch(() => {/* 忽略 */});
    }

    // 立刻 ping 一次让登录后状态立即生效
    ping();
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);

    // 标签页重新可见时也补一次心跳
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
