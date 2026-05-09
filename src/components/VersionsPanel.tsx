'use client';

/**
 * 版本历史面板 — 浮在右上角的 popover
 *
 * 对应 v0 demo 的 #ver-panel。
 * 数据流:
 *   - mount + open 时 fetch GET /api/projects/[id]/versions
 *   - 点"预览" → onPreview(versionId) (父组件去拉 content + 切 iframe)
 *   - 点"回滚" → POST /api/projects/[id]/versions/[v]/rollback → onRollbacked()
 *
 * 列表顺序: 最新在最上 (与 demo 一致)。
 */

import { useEffect, useState } from 'react';
import type { VersionMeta } from '@/lib/versions';

type Props = {
  projectId: string;
  currentVersionId: string | null;
  previewVersionId: string | null;
  onClose: () => void;
  onPreview: (versionId: string) => void;
  onExitPreview: () => void;
  onRollbacked: () => void;
};

function formatRelTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  const d = Math.floor(h / 24);
  return `${d}d 前`;
}

export default function VersionsPanel({
  projectId,
  currentVersionId,
  previewVersionId,
  onClose,
  onPreview,
  onExitPreview,
  onRollbacked,
}: Props) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  // 拉版本列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/versions`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.ok) setVersions(j.versions);
        else setError(j.error || '加载失败');
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, currentVersionId]); // currentVersionId 变了 (合成/回滚) 重拉

  // ESC 关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleRollback(versionId: string) {
    setRollingBack(versionId);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/versions/${versionId}/rollback`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `回滚失败 (${res.status})`);
        return;
      }
      onRollbacked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRollingBack(null);
    }
  }

  // 反序展示 (最新在顶,与 demo 一致)
  const display = [...versions].reverse();
  // 版本号: 在原数组里的 index + 1
  const versionNumber = (id: string) => {
    const idx = versions.findIndex(v => v.id === id);
    return idx >= 0 ? idx + 1 : '?';
  };

  return (
    <>
      <div className="ver-panel-backdrop" onClick={onClose} aria-hidden />
      <div className="ver-panel show" role="dialog" aria-label="版本历史">
        <div className="ver-head">
          <div>
            <div className="ver-title">版本历史</div>
            <div className="ver-sub">每次合成/回滚都会留一版,可以预览或一键回滚</div>
          </div>
          <button
            type="button"
            className="ver-close"
            onClick={onClose}
            title="关闭 (Esc)"
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {previewVersionId && (
          <div className="ver-preview-banner">
            <span className="ver-preview-badge">预览中</span>
            <span>点「回滚」永久切到此版本,或</span>
            <button
              type="button"
              className="ver-action"
              onClick={onExitPreview}
            >
              退出预览
            </button>
          </div>
        )}

        <div className="ver-list">
          {loading ? (
            <div className="ver-empty">加载中…</div>
          ) : error ? (
            <div className="ver-empty">⚠️ {error}</div>
          ) : display.length === 0 ? (
            <div className="ver-empty">
              还没有版本。<br />
              触发一次合成后会自动留版本。
            </div>
          ) : (
            display.map(v => {
              const isCurrent = v.id === currentVersionId;
              const isPreviewing = v.id === previewVersionId;
              return (
                <div
                  key={v.id}
                  className={`ver-item ${isCurrent ? 'active' : ''} ${isPreviewing ? 'previewing' : ''}`}
                >
                  <span className="ver-num">v{versionNumber(v.id)}</span>
                  <div className="ver-body">
                    <div className="ver-label">
                      {isCurrent ? (
                        <span className="ver-current-badge">当前</span>
                      ) : isPreviewing ? (
                        <span className="ver-preview-badge">预览</span>
                      ) : null}
                      {' '}
                      由 {v.intentIds.length} 条 Intent 合成
                    </div>
                    <div className="ver-meta">
                      <span className="ver-meta-actor">AI · 合成</span>
                      <span className="ver-meta-sep" />
                      <span>{formatRelTime(v.createdAt)}</span>
                    </div>
                  </div>
                  {!isCurrent && !isPreviewing && (
                    <div className="ver-actions-wrap">
                      <button
                        type="button"
                        className="ver-action ver-preview"
                        onClick={() => onPreview(v.id)}
                        title="临时预览此版本"
                      >
                        预览
                      </button>
                      <button
                        type="button"
                        className="ver-action ver-rollback"
                        onClick={() => handleRollback(v.id)}
                        disabled={rollingBack === v.id}
                        title="回滚到此版本 (作为新版本写入)"
                      >
                        {rollingBack === v.id ? '回滚中…' : '回滚'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
