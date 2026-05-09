'use client';

/**
 * 发布成功的庆祝弹窗 — 对应 v0 demo 的 .celebrate-card.evolution。
 *
 * V1 简化版:
 *   - 没有 conic-gradient 边框光晕和 confetti spark (demo 的花活)
 *   - 保留: 金色 icon halo + eyebrow + title + sub + 4 stats
 */

import { useEffect } from 'react';

type Stat = { num: string | number; label: string };

type Props = {
  open: boolean;
  title: string;
  sub: React.ReactNode;
  stats: Stat[];
  onClose: () => void;
};

export default function CelebrationModal({
  open,
  title,
  sub,
  stats,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="celebrate-overlay"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="发布成功"
    >
      <div className="celebrate-card evolution">
        <div className="celebrate-icon" aria-hidden>✨</div>
        <div className="celebrate-eyebrow">
          <span className="dot" />
          产物定稿
        </div>
        <h2 className="celebrate-title">{title}</h2>
        <p className="celebrate-sub">{sub}</p>
        <div className="celebrate-stats">
          {stats.map((s, i) => (
            <div key={i} className="celebrate-stat">
              <div className="celebrate-stat-num">{s.num}</div>
              <div className="celebrate-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="celebrate-close-btn"
          onClick={onClose}
          autoFocus
        >
          继续协作
        </button>
      </div>
    </div>
  );
}
