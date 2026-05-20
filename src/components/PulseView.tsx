'use client';

/**
 * 团队脉搏 — 首页 / 默认视图。
 *
 * "团队此刻在想什么" 而不是 "你的项目列表"。
 * 三栏:
 *   1. 活跃项目 (每条挂最新 intent 一句 + 时间 + 未消化张力数)
 *   2. 待消化的张力 (跨项目 flatten, 按创建时间倒序)
 *   3. 团队最近沉淀 (复用 timeline event 卡, 含 retrospect / learning / consensus / agent-event / onboarding)
 *
 * 数据来自 Server Component (page.tsx → safeLoad → getTeamPulse)。
 * 用户手动刷新或导航回首页时更新; 不做 WebSocket 实时, 避免 polling storm 风险。
 */

import Link from 'next/link';
import type { TeamPulse } from '@/lib/pulse';
import type { MemoryEvent } from '@/lib/types';
import { parseStatementForDisplay } from '@/lib/parse-statement';

// 跟 MemoryShell 保持一致 — 5 种 kind 配色
const KIND_COLOR: Record<MemoryEvent['kind'], string> = {
  consensus: '#4F46E5',
  'agent-event': '#06B6D4',
  onboarding: '#94A3B8',
  learning: '#A78BFA',
  retrospect: '#F59E0B',
};
const KIND_LABEL: Record<MemoryEvent['kind'], string> = {
  consensus: '共识',
  'agent-event': 'Agent 互动',
  onboarding: '入职',
  learning: '学习',
  retrospect: '复盘',
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const d = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (d < 60) return '刚刚';
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  return `${Math.floor(d / 86400)} 天前`;
}

// markdown bold 简易渲染 — body 用 **name** 包名字; 不引第三方 markdown 库, 只把 **xxx** 变 <strong>
function renderInlineBold(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}

export default function PulseView({ pulse }: { pulse: TeamPulse | null }) {
  if (!pulse) {
    return (
      <div className="pulse-empty">
        <div className="pulse-empty-headline">脉搏暂时读不到</div>
        <div className="pulse-empty-sub">服务端聚合失败,看不到团队当前状态。切到"全部项目"看 grid 视图,或刷新重试。</div>
      </div>
    );
  }

  const { activeProjects, unresolvedTensions, recentEvents } = pulse;
  const allEmpty = activeProjects.length === 0 && unresolvedTensions.length === 0 && recentEvents.length === 0;

  if (allEmpty) {
    return (
      <div className="pulse-empty">
        <div className="pulse-empty-headline">此刻团队没在想什么。</div>
        <div className="pulse-empty-sub">开一个新项目, Intent 一旦动起来, 这里就开始有动静。</div>
      </div>
    );
  }

  return (
    <div className="pulse-grid">
      {/* 团队此刻在想什么 */}
      <section className="pulse-section pulse-section-projects">
        <header className="pulse-section-head">
          <h2 className="pulse-section-title">团队此刻在想什么</h2>
          <span className="pulse-section-count">{activeProjects.length} 个活跃项目</span>
        </header>
        {activeProjects.length === 0 ? (
          <div className="pulse-section-empty">没有正在协作的项目。</div>
        ) : (
          <div className="pulse-projects">
            {activeProjects.map(p => {
              const li = p.latestIntent;
              const intentText = li ? parseStatementForDisplay(li.statement).userText || li.statement : '';
              return (
                <Link href={`/projects/${p.projectId}`} key={p.projectId} className="pulse-project-card">
                  <div className="pulse-project-head">
                    <span className="pulse-project-name">{p.name}</span>
                    <span className={`pulse-project-status pulse-status-${p.status}`}>
                      {p.status === 'collaborating' ? '协作中' :
                       p.status === 'tension' ? '有分歧' :
                       p.status === 'converged' ? '已收敛' :
                       p.status === 'draft' ? '草稿' : p.status}
                    </span>
                  </div>
                  {li ? (
                    <div className="pulse-project-intent">
                      <span className={`avatar ${li.authorCls}${li.authorKind === 'agent' ? ' agent' : ''}`}>
                        {li.authorName.slice(0, 1)}
                      </span>
                      <span className="pulse-project-intent-body">
                        <span className="pulse-project-intent-text">{intentText.slice(0, 100)}</span>
                        <span className="pulse-project-intent-meta">
                          {li.authorName} · {relTime(li.createdAt)}
                        </span>
                      </span>
                    </div>
                  ) : (
                    <div className="pulse-project-intent pulse-project-intent-empty">还没有 intent</div>
                  )}
                  <div className="pulse-project-foot">
                    <span>{p.intentsCount} 条意图</span>
                    {p.unresolvedTensionsCount > 0 && (
                      <span className="pulse-project-tensions">
                        🟠 {p.unresolvedTensionsCount} 张力未消化
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* 待消化的张力 */}
      <section className="pulse-section pulse-section-tensions">
        <header className="pulse-section-head">
          <h2 className="pulse-section-title">待消化的张力</h2>
          <span className="pulse-section-count">{unresolvedTensions.length}</span>
        </header>
        {unresolvedTensions.length === 0 ? (
          <div className="pulse-section-empty">所有项目都收敛了。</div>
        ) : (
          <div className="pulse-tensions">
            {unresolvedTensions.map(t => (
              <Link
                key={t.tensionId}
                href={`/projects/${t.projectId}#tension-${t.tensionId}`}
                className="pulse-tension-chip"
              >
                <span className="pulse-tension-dot" aria-hidden>🟠</span>
                <span className="pulse-tension-scope">{t.scope}</span>
                <span className="pulse-tension-meta">
                  {t.variant === 'agents' ? 'Agent⇄Agent' : ''} · 项目「{t.projectName}」 · {t.ageMinutes} 分钟前
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 团队最近沉淀 */}
      <section className="pulse-section pulse-section-events">
        <header className="pulse-section-head">
          <h2 className="pulse-section-title">团队最近沉淀</h2>
          <Link href="/memory" className="pulse-section-more">查看全部 →</Link>
        </header>
        {recentEvents.length === 0 ? (
          <div className="pulse-section-empty">还没有沉淀事件。先去做一个项目, 决策和学习会沉到这里。</div>
        ) : (
          <div className="pulse-events">
            {recentEvents.map(e => (
              <div key={e.id} className="pulse-event">
                <span
                  className="pulse-event-dot"
                  style={{ backgroundColor: KIND_COLOR[e.kind] }}
                  aria-hidden
                />
                <div className="pulse-event-body">
                  <div className="pulse-event-headline">{renderInlineBold(e.body)}</div>
                  <div className="pulse-event-meta">
                    <span
                      className="pulse-event-kind"
                      style={{ color: KIND_COLOR[e.kind] }}
                    >
                      {KIND_LABEL[e.kind]}
                    </span>
                    <span> · {e.meta} · {relTime(e.date)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
