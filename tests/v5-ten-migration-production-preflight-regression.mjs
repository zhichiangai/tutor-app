// Metadata-only A1 preflight contract: never writes to Production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const manifest=JSON.parse(read('docs/v5/catalog/V5_A1_TEN_MIGRATION_SOURCE_LOCK_20261109.json'));
const sql=read('supabase/diagnostics/v5_production_a1_ten_migration_gate_readonly.sql');

test('Ten-file read-only A1 metadata preflight matches the exact locked source versions',()=>{
 const versions=manifest.migration_files.map(x=>x.version);
 assert.equal(versions.length,10);
 const block=sql.match(/v5\(version\)\s+AS\s*\(\s*VALUES([\s\S]*?)\)/i);
 assert.ok(block,'Missing v5 version list');
 const rows=Array.from(block[1].matchAll(/'(\d{14})'/g),x=>x[1]);
 assert.deepEqual(rows,versions,'Preflight must cover all ten A1 migrations');
 assert.match(sql,/v5_version_collisions/);
 assert.match(sql,/actual_43_history_schema_replay_verified',false/);
});

test('Ten-file A1 SQL is a single metadata SELECT and cannot mutate Production',()=>{
 const executable=sql.replace(/^\s*--.*$/gm,'').trim();
 assert.match(executable,/^WITH\s+h\s+AS\s*\(/i);
 assert.match(executable,/\bSELECT jsonb_build_object\(/i);
 assert.equal((executable.match(/;/g)||[]).length,1,'One SQL statement only');
 assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|DO|CALL|COPY|EXECUTE)\b/i);
 for(const forbidden of ['pg_read_file','pg_ls_dir','pg_execute_server_program','auth.users','payment_batch_items pbi']){
  assert.ok(!executable.includes(forbidden));
 }
});
