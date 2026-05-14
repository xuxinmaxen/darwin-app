import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
const env = (await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split('\n').reduce((m,l)=>{if(!l||l.startsWith('#'))return m;const i=l.indexOf('=');if(i<0)return m;m[l.slice(0,i).trim()]=l.slice(i+1).trim();return m;},{});
const c = createClient((env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/rest.*$/,''), env.SUPABASE_SERVICE_ROLE_KEY);

// 拿任意一条 versions 行看列名
const r = await c.from('versions').select('*').limit(1);
console.log('versions sample row (keys):', r.data?.[0] ? Object.keys(r.data[0]) : '(empty)');
console.log('error:', r.error);

// 探针: project_id 行数
const c1 = await c.from('versions').select('*', { count: 'exact', head: true }).eq('project_id', '1033fdf2-a569-446e-8a9d-64f1081b3d98');
console.log(`versions WHERE project_id=...: count=${c1.count}, error=${c1.error?.message}`);

const c2 = await c.from('versions').select('*').eq('project_id', '1033fdf2-a569-446e-8a9d-64f1081b3d98').order('created_at', {ascending: false}).limit(3);
console.log('detail:', JSON.stringify(c2.data?.map(v => ({...v, content: v.content ? `[${v.content.length}c]` : v.content, snapshot: v.snapshot ? '[exists]' : null})), null, 2), 'err:', c2.error?.message);
