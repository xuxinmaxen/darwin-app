'use client';

import { useState } from 'react';

/**
 * 顶栏右侧控制簇 — 溯源 / 版本 / 导出 / 发布
 */

type Props = {
  traceMode: boolean;
  onTraceToggle: () => void;

  versionLabel: string;
  versionsTotal: number;
  versionPanelOpen: boolean;
  onVersionsToggle: () => void;

  canPublish: boolean;
  isPublished: boolean;
  publishing: boolean;
  onPublishClick: () => void;

  /** 项目类型 — 决定导出格式 */
  projectType: 'html' | 'ppt' | 'doc' | 'design';
  projectId: string;
  /** 有合成版本才允许导出 */
  hasVersion: boolean;
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
  projectType,
  projectId,
  hasVersion,
}: Props) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!hasVersion || exporting) return;
    const format = projectType === 'html' ? 'html' : 'pptx';
    setExporting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/export?format=${format}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || '导出失败');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Content-Disposition 里的 filename 浏览器会自动用;这里做兜底
      a.download = format === 'html' ? `output.html` : `output.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

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

      {/* 导出按钮 — 落地页导出 .html, PPT 导出 .pptx */}
      {(projectType === 'html' || projectType === 'ppt') && (
        <button
          type="button"
          className="ctrl"
          onClick={handleExport}
          disabled={!hasVersion || exporting}
          title={
            !hasVersion
              ? '合成出第一版后才能导出'
              : projectType === 'html'
              ? '导出为 HTML 文件到本地'
              : '导出为 PPTX 文件到本地'
          }
        >
          {exporting ? (
            <>
              <span className="ctrl-spinner" />
              导出中…
            </>
          ) : (
            <>
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M7 9V2M4 6l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 11h10" strokeLinecap="round" />
              </svg>
              导出
            </>
          )}
        </button>
      )}

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
