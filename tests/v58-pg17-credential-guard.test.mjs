import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertProductionTarget} from '../scripts/release/v58-pg17-credential-guard.mjs';
const guard=fileURLToPath(new URL('../scripts/release/v58-pg17-credential-guard.mjs',import.meta.url));
const oldScript=fileURLToPath(new URL('../scripts/release/v58-private-backup.sh',import.meta.url));
test('pgpass guard enforces project/TLS/private destination without exposing credentials',()=>{
 const base=mkdtempSync(join(tmpdir(),'v58-synthetic-pg17-')); 
 try{
  chmodSync(base,0o700);
  const parent=join(base,'private');mkdirSync(parent,{mode:0o700});
  const pgpass=join(base,'pgpass');writeFileSync(pgpass,'fake:5432:postgres:fake:synthetic-only-not-real\n',{mode:0o600});
  const e={PGHOST:'db.vctisuglfoxyuwlvyjee.supabase.co',PGPORT:'5432',
   PGUSER:'postgres',PGDATABASE:'postgres',PGSSLMODE:'require',
   PGPASSFILE:pgpass,V58_PRIVATE_BACKUP_DIR:join(parent,'new-nonexistent')};
  assert.equal(assertProductionTarget(e).status,'PASS');
  const direct=spawnSync(process.execPath,[guard],{env:{...e},encoding:'utf8'});
  assert.equal(direct.status,0);
  assert.equal(JSON.parse(direct.stdout).credentials_printed,0);
  assert.doesNotMatch(direct.stdout+direct.stderr,/synthetic-only-not-real/);
  assert.equal(assertProductionTarget({...e,PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
    PGUSER:'postgres.vctisuglfoxyuwlvyjee'}).mode,'session_pooler');
  for(const mutation of [
   {PGHOST:'db.another-project.supabase.co'},
   {PGUSER:'postgres.wrong'},
   {PGPORT:'6543'},
   {PGSSLMODE:'disable'},
   {PGDATABASE:'other'},
   {PGPASSWORD:'synthetic-only-not-real'},
   {V58_PRIVATE_DB_URL:'postgres://synthetic-only-not-real'},
   {PGSERVICE:'default'},
   {PGHOSTADDR:'127.0.0.1'}
  ]) assert.throws(()=>assertProductionTarget({...e,...mutation}));
  chmodSync(pgpass,0o644);
  assert.throws(()=>assertProductionTarget(e),'must reject readable passfile');
  const script=readFileSync(oldScript,'utf8');
  assert.doesNotMatch(script,/supabase db dump|--db-url=|--remote=|V58_PRIVATE_DB_URL/);
  assert.match(script,/pg_dump --format=custom/);
  assert.match(script,/--no-role-passwords/);
  assert.match(script,/v58-pg17-credential-guard/);
 }finally{rmSync(base,{recursive:true,force:true});}
});
