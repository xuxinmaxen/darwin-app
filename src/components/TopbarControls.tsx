'use client';

/**
 * 顶栏右侧控制簇 — 溯源 / 版本 / 发布
 *
 * 对应 v0 demo 的 #btn-prov / #btn-versions / #btn-publish。
 * 状态和数据由 ProjectShell 管,本组件纯 presentational。
 *
 * 三个按钮的 enable 规则:
 *   - 溯源:    始终可点 (即使没合成,也只是 toggle 一个空的状态)
 *   - 版本:    只有 versionsTotal > 0 才 enable
 *   - 发布:    canPublish 由父组件计算 (≥1 个版本 + 不在合成中 + 未发布)
 */

type Props = {
  traceMode: boolean;
  onTraceToggle: () => void;

  versionLabel: string;       // 'v0' / 'v3' / etc.
  versionsTotal: number;
  versionPanelOpen: boolean;
  onVersionsToggle: () => void;

  canPublish: boolean;
  isPublished: boolean;
  publishing: boolean;
  onPublishClick: () => void;
};

export default function TopbarControls({
  traceMode,
  onTraceToggle,
  versionLabel,
  versionsTotal,
  versionPanelOpen,
  onVersionsToggle,
  canPublish,
  isPublished,
  publishing,
  onPublishClick,
}: Props) {
  return (
    <div className="topbar-controls">
      <button
        type="button"
        className={`ctrl toggle ${traceMode ? 'active' : ''}`}
        onClick={onTraceToggle}
        title={traceMode ? '关闭溯源' : '溯源:看每块由谁的意图驱动'}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <circle cx="7" cy="7" r="2.5" />
          <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" strokeLinecap="round" />
        </svg>
        溯源
      </button>

      <button
        type="button"
        className={`ctrl ${versionPanelOpen ? 'active' : ''}`}
        onClick={onVersionsToggle}
        disabled={versionsTotal === 0}
        title={versionsTotal === 0 ? '还没有版本' : `版本历史 (${versionsTotal})`}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <circle cx="7" cy="7" r="5.5" />
          <path d="M7 4v3l2 1.5" strokeLinecap="round" />
        </svg>
        <span className="ctrl-version-label">{versionLabel}</span>
      </button>

      <button
        type="button"
        className={`ctrl publish ${isPublished ? 'is-published' : ''}`}
        onClick={onPublishClick}
        disabled={!canPublish || publishing}
        title={
          isPublished
            ? '已发布'
            : !canPublish
              ? '等 AI 合成出第一版,就能发布'
              : '发布这一版'
        }
      >
        {isPublished ? (
          <>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M2.5 7.5L6 11l5.5-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            已发布
          </>
        ) : publishing ? (
          <>
            <span className="ctrl-spinner" />
            发布中…
          </>
        ) : (
          <>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path d="M7 11V3M3.5 6.5L7 3l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            发布
          </>
        )}
      </button>
    </div>
  );
}
