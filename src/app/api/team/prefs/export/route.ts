/**
 * GET /api/team/prefs/export
 * 把团队共识导出为 markdown,可粘贴到 Claude / GPT / Cursor 全局规范。
 *
 * Content-Type: text/markdown, attachment download。
 */

import { listPrefs, prefsToMarkdown } from '@/lib/team-memory';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export async function GET() {
  const prefs = await listPrefs(DEMO_OWNER_ID);
  const md = prefsToMarkdown(prefs);
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="darwin-team-prefs.md"`,
    },
  });
}
