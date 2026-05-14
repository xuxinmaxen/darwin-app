// 紧急: 把卡住的 synthesis_running 标志强制清掉, 让用户能继续
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);

const pid = process.argv[2];
if (!pid) { console.error('usage: force-release-zombie.mjs <project-id>'); process.exit(1); }

const r = await c.from('projects').update({
  synthesis_running: false,
  synthesis_phase: 'error',
  synthesis_thinking_msg: null,
  synthesis_partial_html: null,
  synthesis_pending_intent_ids: null,
  synthesis_error: '函数被 Vercel timeout 强杀, 已手动清理',
  synthesis_updated_at: new Date().toISOString(),
}).eq('id', pid);
console.log(r.error ? `ERROR: ${r.error.message}` : `released ${pid}`);
