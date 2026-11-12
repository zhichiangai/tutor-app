// V5 A1 source-only release preflight; does NOT authorize or apply Production SQL.
// The older nine-file manifest remains immutable. V5.7 adds a tenth SQL file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const readJson=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const old=readJson('docs/v5/catalog/V5_A1_NINE_MIGRATION_SOURCE_LOCK_20261108.json');
const current=readJson('docs/v5/catalog/V5_A1_TEN_MIGRATION_SOURCE_LOCK_20261109.json');
const directory=new URL('supabase/migrations/',root);
const migrationFiles=readdirSync(directory)
 .filter(name=>/^\d{14}_v5(?:\d+)?_.+\.sql$/.test(name)).sort();

test('A1 ten-file Production release remains NO-GO without independent gates',()=>{
 assert.equal(current.schema_version,1);
 assert.equal(current.approved_release,'NO_GO');
 assert.match(current.source_commit_sha,/^[0-9a-f]{40}$/);
 assert.equal(old.approved_release,'NO_GO');
 assert.equal(old.migration_files.length,9);
 for(const [key,verified] of Object.entries(current.gate)){
  assert.equal(verified,false,'Not allowed to claim gate passed: '+key);
 }
});

test('V5.7 tenth migration is included without mutating the nine-file source lock',()=>{
 assert.equal(current.verification,'git_blob_sha1_exact_bytes');
 assert.equal(current.migration_files.length,10);
 assert.deepEqual(current.migration_files.slice(0,9),old.migration_files);
 const names=current.migration_files.map(x=>x.path.replace('supabase/migrations/',''));
 assert.deepEqual(names,migrationFiles.slice(0,10),'Historical ten-file source lock must remain untouched');
 assert.deepEqual(migrationFiles.slice(10,12),['20261109163000_v5_6_team_refund_correction_ledger.sql','20261110032000_v5_6_team_allocated_refund_intake.sql']);
 assert.equal(new Set(current.migration_files.map(x=>x.version)).size,10);
 assert.deepEqual([...names].sort(),names);
 assert.ok(names.at(-1).includes('_v57_team_operations_overview.sql'));
 for(const item of current.migration_files){
  assert.match(item.path,/^supabase\/migrations\/\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/);
  assert.equal(item.version,item.path.split('/').at(-1).slice(0,14));
  assert.match(item.git_blob_sha1,/^[a-f0-9]{40}$/);
  const file=readFileSync(new URL(item.path,root));
  const digest=createHash('sha1').update('blob '+file.byteLength+'\0').update(file).digest('hex');
  assert.equal(file.byteLength,item.bytes,'Changed SQL byte length: '+item.path);
  assert.equal(digest,item.git_blob_sha1,'Changed SQL source bytes: '+item.path);
 }
});
