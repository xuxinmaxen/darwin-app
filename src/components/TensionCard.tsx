'use client';

/**
 * Tension 卡片 — 在产物画布上 overlay 显示。
 *
 * 设计意图:
 *   - 不弹模态 (会盖住产物), 用 absolute 浮在画布右上方
 *   - 有 active tension 时常驻; 解决后消失
 *   - 用户可: 点 A/B/C 直接仲裁 / 开讨论 (v2 stage 2) / 让 AI 决策 (v2 stage 2)
 *
 * 当前 v2 stage 1: 只支持直接选项 (开讨论/AI 决策需要讨论抽屉, 下个 commit)。
 */

import { useState } from 'react';
import type { Tension, Intent } from '@/lib/types';
import type { Employee } from '@/lib/employees';

const KEY_LABELS = ['A', 'B', 'C', 'D', 'E'];

type Props = {
  projectId: string;
  tension: Tension;
  intentMap: Map<string, Intent>;
  employeeMap: Map<string, Employee>;
  onResolved: (tensionId: string) => void;
};

export default function TensionCard({
  projectId,
  tension,
  intentMap,
  employeeMap,
  onResolved,
}: Props) {
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 双方信息 (从 intentMap 反查作者)
  const partyAIntent = intentMap.get(tension.intentIds[0]);
  const partyBIntent = intentMap.get(tension.intentIds[1]);
  const partyA = partyAIntent ? employeeMap.get(partyAIntent.authorId) : null;
  const partyB = partyBIntent ? employeeMap.get(partyBIntent.authorId) : null;

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
      onResolved(tension.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelecting(null);
    }
  }

  return (
    <div className={`tension-card ${tension.variant === 'agents' ? 'agents' : ''}`}>
      <div className="tension-head">
        <span className="tension-tag">
          <span className="dot" />
          {tension.variant === 'agents' ? 'AGENT ⇄ AGENT' : '冲突'}
        </span>
        <span className="tension-scope">
          scope · <strong>{tension.scope}</strong>
        </span>
      </div>

      <div className="tension-title">
        {tension.intentIds.length} 条 must Intent 在 <strong>{tension.scope}</strong> 区块语义对立
      </div>
      <div className="tension-desc">
        AI 已生成 {tension.options.length} 个调和方案,等待团队选择或讨论。
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
              <div className="vs-text">{partyAIntent.statement}</div>
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
              <div className="vs-text">{partyBIntent.statement}</div>
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
              disabled={selecting !== null}
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
        AI 是调和者,人是仲裁者。决议会写入团队记忆。
      </div>
    </div>
  );
}
