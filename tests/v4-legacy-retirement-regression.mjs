// Offline guard: retired V1 code must not re-enter the active tree.
// Historical SQL and active V4 GAS notifications must remain intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const here=p=>new URL('../'+p,import.meta.url);
const read=p=>readFileSync(here(p),'utf8');

test('retired V1 site and legacy GAS data API are absent',()=>{
 for(const path of ['frontend/index.html','frontend/app.js','frontend/style.css',
  'backend/apps-script/Code.js','backend/apps-script/appsscript.json',
  'docs/legacy-readme-20261019.md','docs/legacy-v2-readme-20261020.md']){
  assert.equal(existsSync(here(path)),false,path);
 }
 assert.doesNotMatch(read('index.html'),/frontend\//i);
});
test('Vercel continues to route to the maintained frontend and active V4 integrations',()=>{
 const config=JSON.parse(read('vercel.json'));
 assert.deepEqual(config.rewrites.find(x=>x.source==='/'),
  {source:'/',destination:'/v2/index.html'});
 for(const path of ['v2/index.html','v2/app.js','v2/style.css',
   'integrations/google-apps-script/v4-notifications/Code.gs',
   'supabase/functions/v4-gas-bridge/index.ts',
   'supabase/migrations/20261023090000_v4_bidirectional_invites_gas.sql'])
  assert.equal(existsSync(here(path)),true,path);
 assert.match(read('AGENTS.md'),/ONLY maintained frontend/);
});
