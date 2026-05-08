'use client';

/**
 * 项目画布 — Client Component
 *
 * 状态:
 *   1. 0 条 Intent:           空态插画 + 引导
 *   2. ≥1 条 Intent + 没合成过:  「开始合成」CTA (用户必须点一次,确认要开始)
 *   3. 合成完毕:                iframe 渲染 + 底部状态条
 *
 * 行为:
 *   - 首次合成必须用户点 (避免误触 + 烧 token)
 *   - 之后每次 intents 变化 (新增/删除),debounce 1.5s 自动重合成
 *   - 期间底部状态条显示「AI 正在合成…」脉冲指示
 *   - 失败时显示错误 + 「重试」小按钮
 */

import { useState, useTransition, useEffect, useRef } from 'react';
import type { Project, Intent } from '@/lib/types';
import type { Version } from '@/lib/versions';
import { TYPE_LABEL } from '@/lib/type-meta';

const AUTO_SYNC_DEBOUNCE_MS = 1500;

function hashIds(ids: string[]): string {
  // ID + length 双重指纹,删/加都能检测到
  return ids.slice().sort().join(',') + '|' + ids.length;
}
function hashIntents(intents: Intent[]): string {
  return hashIds(intents.map(i => i.id));
}

export default function ProjectCanvas({
  project,
  intents,
  initialVersion,
  claudeReady,
}: {
  project: Project;
  intents: Intent[];
  initialVersion: Version | null;
  claudeReady: boolean;
}) {
  const [version, setVersion] = useState<Version | null>(initialVersion);
  const [synthSource, setSynthSource] = useState<
    'llm' | 'template' | undefined
  >(initialVersion?.source);
  const [isFirstPending, startFirstTransition] = useTransition();
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 上一次合成时的 intent 指纹。从 version 自带的 intentIds 初始化,
  // 这样进页面就能识别"版本是否落后于当前 intents"。
  const lastSyncedHashRef = useRef<string | null>(
    initialVersion ? hashIds(initialVersion.intentIds) : null
  );

  // ─── 自动重合成 ──────────────────────────────────────────
  useEffect(() => {
    if (!version) return; // 首次还没合成,需要手动点 CTA
    if (intents.length === 0) return; // 全删光保留最后一版
    if (autoSyncing) return; // 当前正在合成,等完了再重检

    const currentHash = hashIntents(intents);
    if (currentHash === lastSyncedHashRef.current) return;

    const timer = setTimeout(() => {
      runSynthesis(currentHash);
    }, AUTO_SYNC_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intents, version, project.id, autoSyncing]);

  async function runSynthesis(intentHash: string) {
    setAutoSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/synthesize`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `请求失败 (${res.status})`);
        return;
      }
      setVersion(json.version);
      setSynthSource(json.source);
      lastSyncedHashRef.current = intentHash;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoSyncing(false);
    }
  }

  function handleFirstSynthesize() {
    setError(null);
    startFirstTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/synthesize`, {
          method: 'POST',
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        setVersion(json.version);
        setSynthSource(json.source);
        lastSyncedHashRef.current = hashIntents(intents);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // ─── State 1: 没有 Intent ────────────────────────────────
  if (intents.length === 0 && !version) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty-illu">
          <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M11 3v16M3 11h16M5.5 5.5l11 11M16.5 5.5l-11 11" />
          </svg>
        </div>
        <div>
          <strong>等待 Intent 输入</strong>
          <p>
            大家各自表达想要什么，AI 会抽取为结构化 Intent，再合成为产物。冲突浮现时不阻塞他人贡献。
          </p>
        </div>
      </div>
    );
  }

  // ─── State 2: 有 Intent,首次没合成 ───────────────────────
  if (!version) {
    return (
      <div className="canvas-cta">
        <div className="canvas-cta-illu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M5 5l4 4M9 5l-4 4M14 5h6M14 9h4M14 13h6M5 17l3 3 8-8" />
          </svg>
        </div>
        <h3 className="canvas-cta-title">
          已收集 {intents.length} 条 Intent · 准备合成 {TYPE_LABEL[project.type]}
        </h3>
        <p className="canvas-cta-sub">
          点下方按钮开始合成。之后每次新增/删除 Intent，AI 会自动重新合成，无需再点。
          {!claudeReady && '（当前 LLM 未连，走本地模板合成）'}
        </p>

        <button
          type="button"
          className="canvas-cta-btn"
          onClick={handleFirstSynthesize}
          disabled={isFirstPending}
        >
          {isFirstPending ? (
            <>
              <span className="canvas-cta-spinner" />
              合成中…
            </>
          ) : (
            <>
              <svg viewBox="0 0 14 14" fill="currentColor">
                <path d="M3.5 2v10l7.5-5z" />
              </svg>
              开始合成
            </>
          )}
        </button>

        {error && <div className="canvas-cta-error">{error}</div>}

        {project.background && (
          <div className="canvas-cta-meta">
            <strong>项目背景</strong>
            <p>{project.background}</p>
          </div>
        )}
      </div>
    );
  }

  // ─── State 3: 有版本 (含全删后保留最后一版) ──────────────
  const isStale =
    intents.length > 0 &&
    hashIntents(intents) !== lastSyncedHashRef.current &&
    !autoSyncing;

  return (
    <div className="canvas-result">
      {project.type === 'html' ? (
        <iframe
          className="canvas-frame"
          srcDoc={version.content}
          title={`${project.name} · synthesized preview`}
          sandbox="allow-same-origin"
        />
      ) : (
        <pre className="canvas-md">{version.content}</pre>
      )}

      <div className="canvas-result-foot">
        <div className="canvas-result-meta">
          {autoSyncing ? (
            <span className="canvas-syncing">
              <span className="canvas-syncing-pulse" />
              AI 正在按新 Intent 重新合成…
            </span>
          ) : isStale ? (
            <span className="canvas-stale">
              <span className="canvas-stale-dot" />
              检测到 Intent 变化，{Math.ceil(AUTO_SYNC_DEBOUNCE_MS / 1000)} 秒内自动重合成…
            </span>
          ) : error ? (
            <span className="canvas-sync-error">
              <span>⚠️ 上次自动合成失败</span>
              <button
                type="button"
                className="canvas-retry-btn"
                onClick={() => runSynthesis(hashIntents(intents))}
              >
                重试
              </button>
            </span>
          ) : (
            <>
              <span
                className={`canvas-source-pill canvas-source-${synthSource || 'template'}`}
                title={
                  synthSource === 'llm'
                    ? 'LLM 直出'
                    : '本地模板（LLM 不可用时回退）'
                }
              >
                {synthSource === 'llm' ? '🤖 LLM' : '⚙️ 模板'}
              </span>
              <span>已同步</span>
              <span>·</span>
              <span>{intents.length} 条 Intent</span>
              <span>·</span>
              <span>
                {new Date(version.createdAt).toLocaleString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </>
          )}
        </div>

        {intents.length === 0 && (
          <span className="canvas-no-intents">所有 Intent 已删,保留最后一版</span>
        )}
      </div>

      {error && !autoSyncing && (
        <div className="canvas-result-error">
          {error.length > 200 ? error.slice(0, 200) + '…' : error}
        </div>
      )}
    </div>
  );
}
