import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);
const r = await c.from('versions')
  .select('id, content, intent_ids, created_at')
  .eq('project_id', '1033fdf2-a569-446e-8a9d-64f1081b3d98')
  .order('created_at', { ascending: true });
for (const [i, v] of (r.data || []).entries()) {
  const ids = JSON.parse(v.intent_ids);
  console.log(`v${i+1} ${v.id.slice(0,8)} at=${v.created_at} content=${v.content.length}c intent_ids=${ids.length} ids`);
}
console.log('TOTAL:', (r.data||[]).length);
