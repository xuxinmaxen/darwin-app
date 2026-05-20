/**
 * GET /api/pulse
 *
 * 返回团队脉搏 JSON — 活跃项目 + 未消化张力 + 最近沉淀事件。
 * 首页 / 走 RSC 拉, 但 e2e 测试需要 JSON 来断言, 所以单独开一个 endpoint。
 */

import { NextResponse } from 'next/server';
import { getTeamPulse } from '@/lib/pulse';
import { currentUserId } from '@/lib/auth';

export async function GET() {
  try {
    const ownerId = await currentUserId();
    const pulse = await getTeamPulse(ownerId);
    return NextResponse.json({ ok: true, pulse });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
