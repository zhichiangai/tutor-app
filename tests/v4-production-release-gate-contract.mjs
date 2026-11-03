// Offline release safety contract. NO cloud access, credentials, or mutation.
// Production history is a read-only snapshot, not a set of migrations to replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const text=path=>readFileSync(new URL(path,root),'utf8');
const manifest=JSON.parse(text('docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json'));
const preflight=text('supabase/diagnostics/v4_production_release_preflight_readonly.sql');
const versions=x=>x.map(p=>p.slice(0,14));

test('release blocks blindly replaying incompatible historical migrations',()=>{
 const files=readdirSync(new URL('supabase/migrations/',root)).filter(p=>p.endsWith('.sql')).sort();
 const replay=manifest.local_replay_baseline_files;
 const pending=manifest.proposed_forward_files;
 assert.deepEqual(files,[...replay,...pending].sort(),'Review and update release map if migrations change');
 assert.equal(manifest.production_history.length,29,'Production baseline requires fresh read-only recheck');
 assert.equal(replay.length,28,'Recovered local replay is NOT one-to-one with Production');
 assert.equal(pending.length,9,'All V4 forward candidates require independent review');
 assert.ok(pending.every(x=>x.startsWith('20261023')||x.startsWith('20261024')||x.startsWith('20261029')));
 assert.equal(new Set(versions(files)).size,files.length,'No migration timestamp collision');
 const actualFormal=manifest.production_history.map(x=>x.version);
 assert.equal(new Set(actualFormal).size,29);
 const direct=replay.filter(f=>actualFormal.includes(f.slice(0,14))).length;
 const missing=actualFormal.filter(v=>!versions(replay).includes(v));
 assert.equal(direct,11);
 assert.equal(missing.length,18);
 assert.equal(manifest.direct_version_matches,direct);
 assert.deepEqual(manifest.formal_versions_missing_from_replay,missing);
 assert.match(manifest.note,/NO db push\/repair/);
});

test('production preflight reads metadata only and never grants release',()=>{
 const noComments=preflight.split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
 assert.doesNotMatch(noComments,/\b(insert|update|delete|alter|drop|truncate|grant|revoke|create|copy|call|execute|perform)\b/i,
  'No schema/data modification is permitted in read-only release diagnostics');
 assert.match(noComments,/supabase_migrations\.schema_migrations/);
 assert.match(noComments,/pg_policies/);
 assert.match(noComments,/student_guardians/);
 assert.match(noComments,/NO_GO_RESTORE_AND_APPROVAL_REQUIRED/);
 const sqlVersions=[...noComments.matchAll(/\('([0-9]{14})'\)/g)].map(m=>m[1]);
 assert.deepEqual(sqlVersions,manifest.production_history.map(x=>x.version),
  'Preflight must compare all formal versions, not just a migration count');
});
