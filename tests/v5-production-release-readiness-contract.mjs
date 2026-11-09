// Offline release gate: it only reads the committed snapshot and repository files.
// It has NO cloud access, secrets, migration execution or Production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const snap=JSON.parse(readFileSync(
 new URL('docs/v5/V5_PRODUCTION_MIGRATION_READONLY_SNAPSHOT_20261106.json',root),
 'utf8'));
const release=readFileSync(new URL(
 'docs/v5/V5_4_PRODUCTION_RELEASE_READINESS_GATE_20261106.md',root),'utf8');

test('V5 Production gate cannot silently infer release approval from CI',()=>{
 assert.equal(snap.release_gate,'NO_GO_RESTORE_AND_COMPATIBILITY_PROOF_REQUIRED');
 assert.equal(snap.backup_restoration_verified,false);
 assert.equal(snap.semantic_equivalence_proven,false);
 assert.equal(snap.approved_for_production,false);
 assert.match(release,/\*\*結論：NO-GO/);
 assert.match(release,/不可執行歷史重播/);
 assert.match(release,/G2 正式備份與隔離還原/);
 assert.match(release,/G3 相容環境 QA/);
 assert.match(release,/G6 發布與回復/);
});

test('Repository Migration inventory matches frozen read-only release snapshot',()=>{
 const files=readdirSync(new URL('supabase/migrations/',root))
  .filter(f=>f.endsWith('.sql')).sort();
 assert.deepEqual(files.slice(0,snap.repo_migration_count),snap.repository_migration_files,
  'Existing V4+V5.5 baseline must remain immutable');
 assert.deepEqual(files.slice(snap.repo_migration_count),[
  '20261108230000_v57_team_operations_overview.sql',
  '20261109163000_v5_6_team_refund_correction_ledger.sql',
  '20261110032000_v5_6_team_allocated_refund_intake.sql',
  '20261110040000_v5_6_team_direct_refund_approval_reversal.sql'
 ],'New V5.7 and V5.6 forward migrations require separately frozen source review');
 assert.equal(files.length,snap.repo_migration_count+4);
 assert.equal(files.filter(x=>/_v5_/.test(x)).length,
  snap.v5_repo_migration_count+3);
 assert.deepEqual(files.filter(x=>/_v5_/.test(x)),[
  '20261104131300_v5_1_entitlements_student_seats.sql',
  '20261105171000_v5_1_admin_qa_release.sql',
  '20261105181500_v5_2_team_projects_invitations.sql',
  '20261105192000_v5_2_team_governance_transfer.sql',
  '20261105201500_v5_3_team_data_boundaries.sql',
  '20261106031000_v5_3_team_billing_foundation.sql',
  '20261106034000_v5_3_partial_payment_allocation.sql',
  '20261106043000_v5_4_team_advance_credit.sql',
  '20261106050000_v5_4_team_monthly_reconciliation.sql',
  '20261109163000_v5_6_team_refund_correction_ledger.sql',
  '20261110032000_v5_6_team_allocated_refund_intake.sql',
  '20261110040000_v5_6_team_direct_refund_approval_reversal.sql'
 ]);
});

test('Production version drift is measured and never marked repaired',()=>{
 assert.equal(snap.production_migration_count,snap.production_migrations.length);
 assert.equal(new Set(snap.production_migrations.map(x=>x.version)).size,
  snap.production_migration_count);
 const repoVersions=new Set(snap.repository_migration_files.map(x=>x.slice(0,14)));
 const missing=snap.production_migrations.filter(x=>!repoVersions.has(x.version));
 assert.deepEqual(missing,snap.unmatched_production_migrations);
 assert.equal(missing.length,snap.unmatched_production_migration_count);
 assert.equal(snap.production_migration_count-missing.length,
  snap.exact_version_matches);
 assert.equal(snap.production_v5_table_count,0,
  'Source snapshot must not assert a V5 schema exists on Production');
 assert.ok(snap.unmatched_production_migration_count>0,
  'Compatibility must be proved, not inferred from matching names');
 assert.equal(snap.production_migrations.at(-1).version,'20261103212647');
});

test('Release sequence preserves the V4 automatic deployment safety boundary',()=>{
 for(const p of [51,52,53,54,55,56]){
  assert.match(release,new RegExp('\\[#'+p+'\\]'));
 }
 assert.match(release,/PR #51 → #52 → #53 → #54 → #55 → #56/);
 assert.match(release,/main.*Vercel Production/);
 assert.match(release,/V5\.1 不是純粹新表 Migration/);
 assert.match(release,/Vercel 回滾不會回滾 Supabase/);
 assert.match(release,/正式資料庫變更與合併 Main/);
});
