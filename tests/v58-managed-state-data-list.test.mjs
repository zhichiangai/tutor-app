import test from 'node:test';
import assert from 'node:assert/strict';
import {selectManagedDataOnly} from './local/v58-managed-state-data-list.mjs';
const synthetic=[
'; synthetic pg_restore --list metadata only',
'1; 0 0 SCHEMA - auth postgres',
'2; 0 0 TABLE auth users postgres',
'3; 0 0 TABLE DATA auth users postgres',
'4; 0 0 TABLE DATA auth identities postgres',
'5; 0 0 TABLE DATA auth sessions postgres',
'6; 0 0 TABLE DATA auth refresh_tokens postgres',
'7; 0 0 TABLE DATA supabase_migrations schema_migrations postgres',
'8; 0 0 TABLE DATA storage objects postgres',
'9; 0 0 TABLE DATA storage buckets postgres',
'10; 0 0 TRIGGER auth users managed_trigger postgres',
'11; 0 0 EXTENSION - pgcrypto postgres',
'12; 0 0 ACL auth users postgres',
'13; 0 0 TABLE DATA public students postgres'
].join('\n');
test('select exactly five synthetic local managed DATA tables, never schema, roles, Storage or trigger',()=>{
 const r=selectManagedDataOnly(synthetic);
 assert.equal(r.tableCount,5);
 assert.equal(r.roleSqlIncluded,false);
 assert.equal(r.schemaDdlIncluded,false);
 assert.equal(r.storageObjectsIncluded,false);
 assert.equal(r.fullRestoreVerified,false);
 for(const name of ['auth users','auth identities','auth sessions',
   'auth refresh_tokens','supabase_migrations schema_migrations'])
  assert.match(r.list,new RegExp('TABLE DATA '+name));
 for(const forbidden of ['TABLE DATA storage objects','TABLE DATA storage buckets',
  'SCHEMA - auth','TRIGGER auth','EXTENSION - pgcrypto','TABLE DATA public'])
  assert.ok(!r.list.includes(forbidden),forbidden);
});
test('refuses missing and duplicate Auth identities/session and migration history',()=>{
 for(const name of ['auth users','auth identities','auth sessions',
     'auth refresh_tokens','supabase_migrations schema_migrations']){
  const absent=synthetic.split('\n').filter(x=>!x.includes('TABLE DATA '+name)).join('\n');
  assert.throws(()=>selectManagedDataOnly(absent),/Missing expected managed table/);
 }
 assert.throws(()=>selectManagedDataOnly(synthetic+'\n14; 0 0 TABLE DATA auth users postgres'),
  /Duplicate table/);
});
