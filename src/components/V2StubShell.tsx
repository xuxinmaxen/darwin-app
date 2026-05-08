'use client';

/**
 * V2 占位页 shell — 复用工作台 topbar + sidebar，把内容区换成「V2 即将上线」。
 */

import Link from 'next/link';
import { Sidebar } from '@/components/WorkspaceShell';

export default function V2StubShell({
  active,
  projectsCount,
  title,
  eyebrow,
  description,
  preview,
}: {
  active: 'memory' | 'employees';
  projectsCount: number;
  title: string;
  eyebrow: string;
  description: string;
  preview: string;
}) {
  return (
    <div className="view-workspace">
      <header className="ws-topbar">
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="brand-logo" aria-hidden />
          <span className="brand-name">Darwin</span>
          <span className="brand-sub">多人意图合成</span>
        </Link>
        <div className="ws-topbar-spacer" />
        <Link href="/" className="back-link">
          ← 返回工作台
        </Link>
      </header>

      <div className="ws-body">
        <Sidebar active={active} projectsCount={projectsCount} />

        <main className="ws-content">
          <section className="ws-section">
            <div className="ws-hero">
              <div className="ws-hero-eyebrow">
                <span className="dot" />
                {eyebrow}
              </div>
              <h1 className="ws-title">{title}</h1>
              <p className="ws-sub">{description}</p>
            </div>

            <div className="proj-empty" style={{ padding: '60px 32px' }}>
              <strong style={{ marginBottom: 12, fontSize: 14 }}>V2 即将上线</strong>
              <div style={{ maxWidth: 560, margin: '0 auto', lineHeight: 1.7 }}>
                {preview}
              </div>
              <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center' }}>
                <Link href="/" className="ws-btn ws-btn-primary" style={{ textDecoration: 'none' }}>
                  返回项目管理
                </Link>
                <Link href="/demo.html" className="ws-btn ws-btn-ghost" style={{ textDecoration: 'none' }}>
                  在 v0 demo 中预览
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
