/**
 * GET /api/team/memory
 * 一次性返回 prefs + agent learning + timeline。
 * 团队记忆页全数据,不分页(组织级数据量小)。
 */

import { NextResponse } from 'next/server';
import {
  listPrefs,
  listAgentLearning,
  listMemoryTimeline,
} from '@/lib/team-memory';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export async function GET() {
  try {
    const [prefs, agents, timeline] = await Promise.all([
      listPrefs(DEMO_OWNER_ID),
      listAgentLearning(DEMO_OWNER_ID),
      listMemoryTimeline(DEMO_OWNER_ID),
    ]);
    return NextResponse.json({ ok: true, prefs, agents, timeline });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
