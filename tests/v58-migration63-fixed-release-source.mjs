// V5.8 release-source lock. Static contract; no DB, network, auth or Production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';

const read=(relative)=>readFileSync(new URL('../'+relative,import.meta.url));
const lock=JSON.parse(read('docs/v5/catalog/V58_PARENT_PROJECT_MIGRATION63_SOURCE_LOCK_20261117.json').toString());
const m=lock.migration;
const actual=read(m.staged_path);
const original=read(m.candidate_path);
const blob=(b)=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');

test('migration63 has one fixed, reviewed version and exact Git source bytes',()=>{
 assert.equal(lock.approved_release,'NO_GO');
 assert.equal(lock.production_sql_authorized,false);
 assert.equal(lock.main_merge_authorized,false);
 assert.equal(lock.release_gate,'NO_GO');
 assert.match(m.version,/^[0-9]{14}$/);
 assert.ok(m.version>lock.target.required_latest_version);
 assert.equal(basename(m.staged_path),m.version+'_'+m.name+'.sql');
 assert.equal(basename(m.canonical_path_after_separate_release_authorization),
  basename(m.staged_path),'Canonical release name must match staged file');
 assert.equal(actual.length,m.bytes);
 assert.equal(blob(actual),m.git_blob_sha1);
 assert.equal(blob(original),m.candidate_git_blob_sha1);
 assert.deepEqual(actual,original,'Release SQL must not drift from audited candidate');
 assert.equal(m.git_blob_sha1,m.candidate_git_blob_sha1);
 assert.equal(lock.target.required_migration_count,62);
 assert.equal(lock.target.new_migration_count,63);
 assert.match(lock.target.required_parent_rpc_body_md5,/^[0-9a-f]{32}$/);
});

test('only the existing parent-finance RPC is replaced; no new direct table grants',()=>{
 const sql=actual.toString('utf8');
 assert.equal((sql.match(/create or replace function public\.v56_team_parent_finance_overview\(/gi)||[]).length,1);
 assert.match(sql,/stable security definer set search_path='' as \$\$/i);
 assert.match(sql,/left join public\.v5_team_projects pr on pr\.id=f\.project_id and pr\.team_id=f\.team_id/);
 assert.match(sql,/'project_id',pr\.id,'project_name',pr\.name/);
 assert.match(sql,/v56_team_family_bridge_revocations/);
 assert.match(sql,/sg\.guardian_id=v_actor/);
 assert.match(sql,/m\.source='direct'/);
 assert.match(sql,/m\.source='applied_credit'/);
 assert.match(sql,/from public,anon,authenticated;\s*grant execute on function/i);
 assert.doesNotMatch(sql,/\b(?:create|alter|drop|truncate)\s+(?:table|view|policy)\b/i);
 assert.doesNotMatch(sql,/\b(?:insert\s+into|delete\s+from|update\s+tutor_private|update\s+public)\b/i);
 assert.doesNotMatch(sql,/grant\s+(?:select|insert|update|delete)\s+on/i);
});
