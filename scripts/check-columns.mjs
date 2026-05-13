// 探针: 通过 Supabase REST 客户端逐列 SELECT, 检查 projects 表上哪些列已经存在
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m, l) => {
    if (!l || l.startsWith('#')) return m;
    const i = l.indexOf('=');
    if (i < 0) return m;
    m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    return m;
  }, {});

const url = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest.*$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const c = createClient(url, key);

const probes = [
  'synthesis_running',
  'synthesis_pending_intent_ids',
  'reference_html',
  'synthesis_partial_html',
  'synthesis_phase',
  'synthesis_thinking_msg',
  'synthesis_started_at',
  'synthesis_updated_at',
  'synthesis_error',
];

for (const p of probes) {
  const r = await c.from('projects').select('id,' + p).limit(1);
  console.log(p.padEnd(35), r.error ? 'MISSING' : 'OK');
}
