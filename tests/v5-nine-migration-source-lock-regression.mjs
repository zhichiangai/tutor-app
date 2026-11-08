// Offline no-network source-lock gate for exactly nine reviewed V5 SQL migrations.
// This checks source bytes, not actual Production migration compatibility.
// It never connects to GitHub, Supabase, Vercel or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL(
 'docs/v5/catalog/V5_A1_NINE_MIGRATION_SOURCE_LOCK_20261108.json',root),'utf8'));
const migrationsDirectory=new URL('supabase/migrations/',root);
const v5Files=readdirSync(migrationsDirectory)
 .filter(name=>/^\d{14}_v5_.+\.sql$/.test(name)).sort();

test('V5 production rollout remains NO-GO until all distinct release approvals',()=>{
 assert.equal(manifest.schema_version,1);
 assert.equal(manifest.source_pr,58);
 assert.match(manifest.source_commit_sha,/^[0-9a-f]{40}$/);
 assert.equal(manifest.approved_release,'NO_GO');
 for(const [gate,passed] of Object.entries(manifest.gate)){
  assert.equal(passed,false,'Release gate may not be assumed: '+gate);
 }
});

test('Exactly nine reviewed forward-only SQL files are source-locked',()=>{
 assert.equal(manifest.verification,'git_blob_sha1_exact_bytes');
 assert.equal(manifest.migration_files.length,9);
 assert.equal(new Set(manifest.migration_files.map(x=>x.version)).size,9);
 const names=manifest.migration_files.map(x=>x.path.replace('supabase/migrations/',''));
 assert.deepEqual(names,v5Files,'V5 file list changed: re-review required before release');
 assert.deepEqual([...names].sort(),names,'Migration files must be in order');
 for(const item of manifest.migration_files){
  assert.match(item.path,/^supabase\/migrations\/\d{14}_v5_[a-z0-9_]+\.sql$/);
  assert.equal(item.version,item.path.split('/').at(-1).slice(0,14));
  assert.match(item.git_blob_sha1,/^[a-f0-9]{40}$/);
  const data=readFileSync(new URL(item.path,root));
  const digest=createHash('sha1').update('blob '+data.byteLength+'\0').update(data).digest('hex');
  assert.equal(data.byteLength,item.bytes,'File byte length changed: '+item.path);
  assert.equal(digest,item.git_blob_sha1,'SQL body changed: '+item.path);
 }
});
