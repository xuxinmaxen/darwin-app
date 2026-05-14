import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);
const pid = process.argv[2] || '1033fdf2-a569-446e-8a9d-64f1081b3d98';
const r = await c.from('projects')
  .select('synthesis_partial_html, synthesis_updated_at, synthesis_running, synthesis_phase, synthesis_started_at')
  .eq('id', pid).maybeSingle();
const ph = r.data?.synthesis_partial_html;
console.log('running:', r.data?.synthesis_running);
console.log('phase:', r.data?.synthesis_phase);
console.log('started_at:', r.data?.synthesis_started_at);
console.log('updated_at:', r.data?.synthesis_updated_at);
const start = new Date(r.data?.synthesis_started_at).getTime();
const last  = new Date(r.data?.synthesis_updated_at).getTime();
console.log(`since start: ${Math.floor((Date.now()-start)/1000)}s, since last heartbeat: ${Math.floor((Date.now()-last)/1000)}s`);
console.log('partialHtml.length:', ph?.length);
if (ph) {
  console.log('head:', ph.slice(0, 300));
  console.log('tail:', ph.slice(-300));
}
