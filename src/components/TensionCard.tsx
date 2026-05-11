'use client';

/**
 * Tension 卡片 — 在产物画布上 overlay 显示。
 *
 * 设计意图:
 *   - 不弹模态 (会盖住产物), 用 absolute 浮在画布右上方
 *   - 有 active tension 时常驻; 解决后消失
 *   - 用户可: 点 A/B/C 直接仲裁 / 开讨论 / 让 AI 仲裁 (取决于 conflictMode)
 *
 * conflictMode:
 *   - 'discuss'    底栏 CTA = 开讨论 → 触发 onDiscuss (打开讨论抽屉)
 *   - 'ai_decide'  底栏 CTA = 让 AI 评分决策 → 调 arbitrate endpoint
 *                  ai_decide 模式下 detect-tension 也会 fire-and-forget 自动仲裁,
 *                  这个按钮主要用作"自动仲裁失败/慢"的人工补救。
 */

import { useState } from 'react';
import type { Tension, Intent } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import { parseStatementForDisplay } from '@/lib/parse-statement';

const KEY_LABELS = ['A', 'B', 'C', 'D', 'E'];

type Props = {
  projectId: string;
  tension: Tension;
  intentMap: Map<string, Intent>;
  employeeMap: Map<string, Employee>;
  conflictMode: 'discuss' | 'ai_decide';
  onResolved: (tension: Tension, selectedKey: string) => void;
  onDiscuss: (tension: Tension) => void;
};

export default function TensionCard({
  projectId,
  tension,
  intentMap,
  employeeMap,
  conflictMode,
  onResolved,
  onDiscuss,
  defaultExpanded = false,
}: Props & { defaultExpanded?: boolean }) {
  const [selecting, setSelecting] = useState<string | null>(null);
  const [arbitrating, setArbitrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  // 双方信息 (从 intentMap 反查作者)
  const partyAIntent = intentMap.get(tension.intentIds[0]);
  const partyBIntent = intentMap.get(tension.intentIds[1]);
  const partyA = partyAIntent ? employeeMap.get(partyAIntent.authorId) : null;
  const partyB = partyBIntent ? employeeMap.get(partyBIntent.authorId) : null;

  const isBusy = selecting !== null || arbitrating;

  async function chooseOption(optionKey: string) {
    setSelecting(optionKey);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tensions/${tension.id}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedOptionKey: optionKey }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `请求失败 (${res.status})`);
        return;
      }
      onResolved(tension, optionKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelecting(null);
    }
  }

  async function handleFooterClick() {
    if (conflictMode !== 'ai_decide') {
      onDiscuss(tension);
      return;
    }
    setArbitrating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tensions/${tension.id}/arbitrate`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `AI 仲裁失败 (${res.status})`);
        return;
      }
      const chosenKey =
        json.tension?.selectedOptionKey ??
        json.selectedOptionKey ??
        tension.options[0]?.key ??
        'A';
      onResolved(tension, chosenKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setArbitrating(false);
    }
  }

  return (
    <div className={`tension-card ${tension.variant === 'agents' ? 'agents' : ''}${arbitrating ? ' rainbow-sweep is-arbitrating' : ''}${expanded ? ' is-expanded' : ' is-collapsed'}`}>
      <button
        type="button"
        className="tension-card-summary"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className="tension-head">
          <span className="tension-tag">
            <span className="dot" />
            {tension.variant === 'agents' ? 'AGENT ⇄ AGENT' : '冲突'}
          </span>
          <span className="tension-scope">
            scope · <strong>{tension.scope}</strong>
          </span>
          <div className="tension-summary-parties">
            {partyA && (
              <span className={`avatar ${partyA.cls}${partyA.kind === 'agent' ? ' agent' : ''}`}>
                {partyA.short}
              </span>
            )}
            <span className="tension-vs-glyph">vs</span>
            {partyB && (
              <span className={`avatar ${partyB.cls}${partyB.kind === 'agent' ? ' agent' : ''}`}>
                {partyB.short}
              </span>
            )}
          </div>
          <span className="tension-card-chevron" aria-hidden>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <div className="tension-title">
          {tension.intentIds.length} 个人在 <strong>{tension.scope}</strong> 上想法对立
        </div>
      </button>

      {expanded && (
      <div className="tension-card-body">
      <div className="tension-desc">
        AI 给了 {tension.options.length} 个折中方案。选一个,或者开个讨论。
      </div>

      {/* 对立双方 */}
      {(partyAIntent || partyBIntent) && (
        <div className="tension-vs">
          {partyAIntent && (
            <div>
              <div className="lbl">
                <span className={`avatar ${partyA?.cls ?? 'xu'}${partyA?.kind === 'agent' ? ' agent' : ''}`}>
                  {partyA?.short ?? '?'}
                </span>
                <span>{partyA?.name ?? '?'}</span>
              </div>
              <div className="vs-text">{parseStatementForDisplay(partyAIntent.statement).userText || partyAIntent.statement}</div>
            </div>
          )}
          {partyBIntent && (
            <div>
              <div className="lbl">
                <span className={`avatar ${partyB?.cls ?? 'xu'}${partyB?.kind === 'agent' ? ' agent' : ''}`}>
                  {partyB?.short ?? '?'}
                </span>
                <span>{partyB?.name ?? '?'}</span>
              </div>
              <div className="vs-text">{parseStatementForDisplay(partyBIntent.statement).userText || partyBIntent.statement}</div>
            </div>
          )}
        </div>
      )}

      {/* 三个调和方案 */}
      <div className="tension-options">
        {tension.options.map((opt, i) => {
          const isSelecting = selecting === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              className="topt"
              onClick={() => chooseOption(opt.key)}
              disabled={isBusy}
            >
              <span className="topt-key">{KEY_LABELS[i] ?? opt.key}</span>
              <span className="topt-body">
                <span className="topt-title">{opt.title}</span>
                <span className="topt-desc">{opt.desc}</span>
              </span>
              {isSelecting && <span className="topt-spinner" />}
            </button>
          );
        })}
      </div>

      {error && <div className="tension-error">⚠️ {error}</div>}

      <div className="tension-foot">
        <button
          type="button"
          className="tension-discuss-btn"
          onClick={handleFooterClick}
          disabled={isBusy}
        >
          {conflictMode === 'ai_decide' ? (
            arbitrating ? (
              <>
                <span className="topt-spinner" style={{ position: 'static', transform: 'none', borderTopColor: 'currentColor' }} />
                AI 决策中…
              </>
            ) : (
              <>
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M7 1.5L8.5 5l3.5 1.2-3.5 1.2L7 11l-1.5-3.5L2 6.2l3.5-1.2z" strokeLinejoin="round" />
                </svg>
                让 AI 替你决定
              </>
            )
          ) : (
            <>
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M2 5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H6l-3 2v-2a3 3 0 0 1-1-2.5V5z" strokeLinejoin="round" />
              </svg>
              开个讨论
            </>
          )}
        </button>
        <span className="tension-foot-hint">
          AI 调和,你拍板。决议会留进团队记忆。
        </span>
      </div>
      </div>
      )}
    </div>
  );
}
