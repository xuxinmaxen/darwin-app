/**
 * 工作台左侧导航。V1 只有"项目管理"可点；其他两项是 V2 占位。
 */

import Link from 'next/link';

type Section = 'projects' | 'memory' | 'employees';

export default function Sidebar({
  active = 'projects',
  projectsCount,
}: {
  active?: Section;
  projectsCount: number;
}) {
  return (
    <aside className="ws-sidebar">
      <nav className="ws-nav">
        <div className="ws-nav-section">工作空间</div>

        <Link
          href="/"
          className={`nav-item${active === 'projects' ? ' active' : ''}`}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M2 4a1 1 0 0 1 1-1h3l1 1.5h4a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
          </svg>
          项目管理
          <span className="nav-count">{projectsCount}</span>
        </Link>

        <button type="button" className="nav-item" disabled title="V2 即将上线">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M3 7a4 4 0 1 1 8 0 4 4 0 1 1-8 0z" />
            <path d="M5.5 7l1.2 1.2L9 6" />
            <circle cx="11.5" cy="2.5" r=".8" fill="currentColor" />
            <circle cx="2.5" cy="11.5" r=".8" fill="currentColor" />
          </svg>
          团队记忆
          <span className="soon">V2</span>
        </button>

        <button type="button" className="nav-item" disabled title="V2 即将上线">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="5" cy="5" r="2.2" />
            <path d="M2 12c.4-1.8 1.7-3 3-3s2.6 1.2 3 3" />
            <circle cx="10" cy="5.5" r="1.8" />
            <path d="M12.5 11c-.3-1.4-1.2-2.4-2.5-2.4" />
          </svg>
          员工管理
          <span className="soon">V2</span>
        </button>
      </nav>

      <div className="ws-sidebar-foot">
        <div>
          Darwin · v1 dev
          <br />
          <Link href="/api/health">/api/health</Link>
          {' · '}
          <Link href="/demo.html">v0 demo</Link>
        </div>
      </div>
    </aside>
  );
}
