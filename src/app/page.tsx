/**
 * 工作台 (V1 placeholder)
 *
 * V1 进度跟踪页 — 显示环境配置状态 + 指引下一步
 * 等 Intent 抽取 / 渲染 / DB 都跑通后,这里换成真正的项目列表
 */

import Link from 'next/link';
import type { HealthResponse } from '@/lib/types';

async function getHealth(): Promise<HealthResponse | null> {
  // SSR 时直接读 env(避免依赖网络)
  return {
    ok: true,
    service: 'darwin',
    version: 'v1.0.0-dev',
    env: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
          process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
    },
    timestamp: new Date().toISOString(),
  };
}

export default async function Home() {
  const health = await getHealth();
  const env = health?.env ?? { anthropic: false, supabase: false };

  return (
    <main className="min-h-screen bg-[#FAF9F5] text-[#1A1A1C]">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-12">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-700">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Darwin · v1 dev
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            多人意图合成
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600">
            让团队的判断被 AI 合成为一份共鸣的产物。
          </p>
        </div>

        <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            环境检查
          </h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span>Anthropic API key</span>
              <StatusBadge ok={env.anthropic} />
            </li>
            <li className="flex items-center justify-between">
              <span>Supabase 配置</span>
              <StatusBadge ok={env.supabase} />
            </li>
          </ul>
          {(!env.anthropic || !env.supabase) && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <strong className="font-semibold">下一步:</strong>
              <ol className="mt-1.5 list-decimal pl-5 space-y-0.5">
                <li>
                  <code>cp .env.example .env.local</code>
                </li>
                <li>
                  填入{' '}
                  <a
                    className="underline"
                    href="https://console.anthropic.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Anthropic API key
                  </a>
                </li>
                <li>
                  在{' '}
                  <a
                    className="underline"
                    href="https://supabase.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Supabase
                  </a>{' '}
                  建项目,把{' '}
                  <code>supabase/schema.sql</code> 跑到 SQL Editor
                </li>
                <li>
                  填入 Supabase URL / anon key / service role key
                </li>
                <li>重启 <code>npm run dev</code></li>
              </ol>
            </div>
          )}
        </section>

        <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            可用入口
          </h2>
          <ul className="space-y-3 text-sm">
            <li>
              <Link
                href="/demo.html"
                className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 transition hover:border-indigo-300 hover:bg-indigo-50"
              >
                <div>
                  <div className="font-medium">v0 Mock Demo</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    脚本驱动,完整跑通 25 步演示流程
                  </div>
                </div>
                <span className="text-zinc-400 group-hover:text-indigo-500">
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/api/health"
                className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 transition hover:border-indigo-300 hover:bg-indigo-50"
              >
                <div>
                  <div className="font-medium">/api/health</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    JSON: 环境配置探针
                  </div>
                </div>
                <span className="text-zinc-400 group-hover:text-indigo-500">
                  →
                </span>
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            V1 工程进度
          </h2>
          <ul className="space-y-1.5 text-sm">
            {V1_TASKS.map(task => (
              <li
                key={task.label}
                className="flex items-center gap-2 text-zinc-700"
              >
                <span
                  className={
                    task.done
                      ? 'text-emerald-600'
                      : 'text-zinc-300'
                  }
                  aria-hidden
                >
                  {task.done ? '●' : '○'}
                </span>
                <span className={task.done ? '' : 'text-zinc-500'}>
                  {task.label}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-zinc-500">
            进度详情见{' '}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              docs/v1-spec.md
            </code>
          </p>
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      missing
    </span>
  );
}

const V1_TASKS = [
  { label: 'types.ts (Intent / Tension / Version)', done: true },
  { label: 'claude.ts (Claude SDK 封装)', done: true },
  { label: 'prompts/extract-intent.ts', done: true },
  { label: 'api/extract route', done: true },
  { label: 'Supabase schema.sql', done: true },
  { label: 'supabase client + server', done: true },
  { label: 'api/synthesize (Intent[] → 产物)', done: false },
  { label: '工作台:项目列表', done: false },
  { label: '项目详情:Intent 看板', done: false },
  { label: '项目详情:产物画布', done: false },
  { label: 'Provenance 追踪', done: false },
  { label: '部署到 Vercel + 端到端验收', done: false },
];
