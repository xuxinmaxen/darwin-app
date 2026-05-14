import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);

const pid = '1033fdf2-a569-446e-8a9d-64f1081b3d98';

const p = await c.from('projects')
  .select('id,name,synthesis_running,synthesis_phase,synthesis_thinking_msg,synthesis_started_at,synthesis_updated_at,synthesis_error,synthesis_pending_intent_ids')
  .eq('id', pid).maybeSingle();
console.log('=== PROJECT ===');
console.log(JSON.stringify(p.data, null, 2));

const v = await c.from('versions').select('id,content,intent_ids,created_at').eq('project_id', pid).order('created_at', {ascending: false}).limit(5);
console.log('\n=== VERSIONS (latest first) ===');
for (const ver of v.data || []) {
  console.log(`---`);
  console.log(`id=${ver.id.slice(0,8)} at=${ver.created_at}`);
  console.log(`intent_ids=${ver.intent_ids}`);
  console.log(`content.length=${ver.content?.length} chars`);
  console.log(`content head: ${ver.content?.slice(0, 300)}`);
  console.log(`content tail: ${ver.content?.slice(-300)}`);
}

console.log('\n=== INTENTS ===');
const i = await c.from('intents').select('id,statement,type,scope,weight,author_kind,created_at').eq('project_id', pid).order('created_at', {ascending: true});
for (const it of i.data || []) {
  console.log(`${it.id.slice(0,8)} [${it.type}·${it.scope}·${it.weight}·${it.author_kind}] ${it.statement.slice(0,120)}`);
}
