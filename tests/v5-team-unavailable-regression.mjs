import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeV5TeamLoadError} from '../v2/v5-team.js';

test('missing Team RPC/table clearly identifies Team backend unavailable',()=>{
 for(const code of ['PGRST202','PGRST205','42P01','42883']){
  const message=describeV5TeamLoadError({code,message:'backend response'});
  assert.match(message,/Team 資料庫尚未啟用/);
  assert.match(message,/個人家教可繼續使用/);
 }
});

test('permission and network failures are never falsely described as missing schema',()=>{
 for(const code of ['PGRST116','PGRST000','42501','PGRST301']){
  assert.doesNotMatch(describeV5TeamLoadError({code,message:'access denied'}),/資料庫尚未啟用/);
 }
});

test('missing PostgREST object fallback handles schema-cache text, not generic PGRST',()=>{
 assert.match(describeV5TeamLoadError({message:"Could not find the table 'public.v5_team_projects' in the schema cache"}),/尚未啟用/);
 assert.match(describeV5TeamLoadError({message:'relation "public.v5_team_roster" does not exist'}),/尚未啟用/);
 assert.doesNotMatch(describeV5TeamLoadError({code:'PGRST002',message:'database connection failed'}),/尚未啟用/);
});

test('Team UI does not show empty projects or retain privileged rows during errors',()=>{
 const js=readFileSync(new URL('../v2/v5-team.js',import.meta.url),'utf8');
 assert.match(js,/if\(loading\|\|error\)\{/);
 assert.match(js,/ready=false;data=null;error='';render\(\)/);
 assert.match(js,/\$\('v5-team-owner-controls'\)\?\.classList\.add\('hidden'\)/);
 assert.match(js,/\$\(key\)\?\.replaceChildren\(\)/);
 assert.match(js,/if\(!ready&&!loading&&!error\)/);
 assert.doesNotMatch(js,/\/PGRST\|relation/);
});
