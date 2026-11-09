// V5.6 twelfth forward SQL is request-only. Prior eleven source bytes remain frozen.
// Offline-only proof. This does not prove Production 43-history compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const readJson=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const old=readJson('docs/v5/catalog/V5_A1_ELEVEN_MIGRATION_SOURCE_LOCK_20261109.json');
const current=readJson('docs/v5/catalog/V5_A1_TWELVE_MIGRATION_SOURCE_LOCK_20261110.json');
const names=readdirSync(new URL('supabase/migrations/',root))
 .filter(x=>/^\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/.test(x)).sort();

test('Twelve-source lock is additive, exact, historical eleven unchanged, NO-GO',()=>{
 assert.equal(old.migration_files.length,11);
 assert.equal(current.migration_files.length,12);
 assert.equal(current.verification,'git_blob_sha1_exact_bytes');
 assert.equal(current.approved_release,'NO_GO');
 assert.deepEqual(current.migration_files.slice(0,11),old.migration_files);
 assert.deepEqual(current.migration_files.map(x=>x.path.split('/').at(-1)),names.slice(0,12));
 assert.equal(current.migration_files.at(-1).path,
  'supabase/migrations/20261110032000_v5_6_team_allocated_refund_intake.sql');
 assert.equal(new Set(current.migration_files.map(x=>x.version)).size,12);
 for(const [gate,value] of Object.entries(current.gate))
  assert.equal(value,false,'Do not falsely assert release gate: '+gate);
});

test('All twelve reviewed SQL blob hashes and exact byte sizes match immutable lock',()=>{
 for(const x of current.migration_files){
  const buf=readFileSync(new URL(x.path,root));
  const digest=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
  assert.equal(buf.length,x.bytes,'Unexpected bytes: '+x.path);
  assert.equal(digest,x.git_blob_sha1,'Unexpected SQL source: '+x.path);
  assert.equal(x.version,x.path.split('/').at(-1).slice(0,14));
 }
});

test('New intake is not booked cash reversal, and authentic 43-history remains a gate',()=>{
 assert.equal(current.gate.real_43_history_schema_replay_verified,false);
 assert.equal(current.gate.allocated_direct_refund_approval_reversal_verified,false);
 assert.equal(current.gate.net_settlement_conservation_verified,false);
 assert.equal(current.gate.production_migration_authorized,false);
 const s=readFileSync(new URL(current.migration_files.at(-1).path,root),'utf8');
 assert.match(s,/requested_no_settlement/);
 assert.match(s,/settlement_changed',false/);
 assert.doesNotMatch(s,/\binsert into tutor_private\.v5_team_payment_allocations\b/);
});
