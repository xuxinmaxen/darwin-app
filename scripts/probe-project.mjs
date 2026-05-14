import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);

const pid = process.argv[2] || '1033fdf2-a569-446e-8a9d-64f1081b3d98';

const p = await c.from('projects')
  .select('id,name,type,synthesis_running,synthesis_phase,synthesis_thinking_msg,synthesis_started_at,synthesis_updated_at,synthesis_error,synthesis_pending_intent_ids')
  .eq('id', pid)
  .maybeSingle();
console.log('=== PROJECT ===');
console.log(JSON.stringify(p.data, null, 2));

const partialP = await c.from('projects').select('synthesis_partial_html').eq('id', pid).maybeSingle();
const ph = partialP.data?.synthesis_partial_html;
console.log('\npartialHtml:', ph ? `[${ph.length} chars] starts: ${ph.slice(0, 200)}` : 'null');

const v = await c.from('versions').select('id,v,created_at').eq('project_id', pid).order('v',{ascending:false}).limit(5);
console.log('\n=== LAST 5 VERSIONS ===');
console.log(JSON.stringify(v.data, null, 2));

const i = await c.from('intents').select('id,statement,type,scope,weight,author_kind,created_at').eq('project_id', pid).order('created_at', {ascending: true});
console.log('\n=== INTENTS ===');
console.log((i.data||[]).map(x=>`[${x.type}·${x.scope}·${x.weight}·${x.author_kind}] ${x.statement.slice(0,80)}`).join('\n'));
