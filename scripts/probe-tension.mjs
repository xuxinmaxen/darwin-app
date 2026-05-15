import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('/Users/maxen/Desktop/darwin-app/.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);
const PID = '1033fdf2-a569-446e-8a9d-64f1081b3d98';

const intents = await c.from('intents').select('id,statement,type,scope,weight,author_kind,created_at').eq('project_id', PID).order('created_at', { ascending: true });
console.log(`\n=== intents (${intents.data?.length || 0}) ===`);
for (const it of intents.data || []) {
  console.log(`[${it.weight}|${it.scope}|${it.type}|${it.author_kind}] ${it.statement.slice(0, 120).replace(/\n/g,' ')}`);
}

const tensions = await c.from('tensions').select('*').eq('project_id', PID);
console.log(`\n=== tensions (${tensions.data?.length || 0}) ===`);
for (const t of tensions.data || []) {
  console.log(JSON.stringify({id:t.id,status:t.status,scope:t.scope,summary:t.summary,a:t.party_a_intent_id,b:t.party_b_intent_id}));
}
