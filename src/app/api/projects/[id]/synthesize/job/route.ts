/**
 * GET /api/projects/[id]/synthesize/job
 *
 * 拉服务端当前合成快照 (running + phase + thinking + partial_html + intent_ids).
 *
 * 客户端 mount 时调一次:
 *   - running=true → 渲染 partial_html 到 iframe + 进入 "resumed" 模式 + 开始轮询
 *   - running=false → 没有进行中的合成, 走正常路径
 *
 * 客户端在 "resumed" 模式下每 1.5s 调一次, 直到 running=false 后再读 /synthesize 拿最终版本.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSynthesisJob } from '@/lib/synthesis-state';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const job = await getSynthesisJob(id);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
