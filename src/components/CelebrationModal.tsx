'use client';

/**
 * 庆祝弹窗 — 两种变体:
 *   variant="consensus" — 冲突调和达成共识时
 *   variant="evolution" — 产物发布定稿时
 *
 * 视觉差异:
 *   - icon (🤝 / ✨)
 *   - eyebrow 渐变色
 *   - 卡片右上角光晕颜色
 *   - stats 数字色
 */

import { useEffect } from 'react';

type Stat = { num: string | number; label: string };

export type CelebrateVariant = 'consensus' | 'evolution';

type Props = {
  open: boolean;
  variant: CelebrateVariant;
  /** 顶部 chip 文字, 如 "共识时刻 · 第 1 次" / "组织进化" */
  eyebrow: string;
  title: string;
  sub: React.ReactNode;
  stats: Stat[];
  onClose: () => void;
  /** 默认按 variant 取 🤝 / ✨ */
  icon?: string;
  /** 默认按 variant 取 "继续 →" / "继续 →" */
  closeBtnText?: string;
  ariaLabel?: string;
};

const DEFAULT_ICON: Record<CelebrateVariant, string> = {
  consensus: '🤝',
  evolution: '✨',
};

export default function CelebrationModal({
  open,
  variant,
  eyebrow,
  title,
  sub,
  stats,
  onClose,
  icon,
  closeBtnText = '继续 →',
  ariaLabel,
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
      aria-label={ariaLabel ?? eyebrow}
    >
      <div className={`celebrate-card ${variant}`}>
        <div className="celebrate-icon" aria-hidden>
          {icon ?? DEFAULT_ICON[variant]}
        </div>
        <div className="celebrate-eyebrow">
          <span className="dot" />
          {eyebrow}
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
          {closeBtnText}
        </button>
      </div>
    </div>
  );
}
