import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkCloudProductionGate} from '../scripts/release/v58-cloud-production-gate.mjs';

const SHA='a'.repeat(40);
const good=()=>({
  GITHUB_ACTIONS:'true',
  GITHUB_REPOSITORY:'zhichiangai/tutor-app',
  GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',
  GITHUB_RUN_ATTEMPT:'1',
  GITHUB_SHA:SHA,
  V58_REVIEWED_MAIN_SHA:SHA,
  V58_BACKUP_PROJECT_REF:'vctisuglfoxyuwlvyjee',
  V58_CLOUD_BACKUP_AUTHORIZATION:'ONE_TIME_PRODUCTION_READ_ONLY_BACKUP',
  V58_BACKUP_EXECUTION_MODE:'ENCRYPTED_DRIVE_ONCE',
  V58_CLOUD_PRODUCTION_BACKUP_RELEASE_ENABLED:'true',
  V58_MAIN_ONLY_PROTECTION_CONFIRMED:'true',
  V58_PRIVATE_KEY_OFFLINE_CONFIRMED:'true',
  V58_PGHOST:'db.vctisuglfoxyuwlvyjee.supabase.co',
  V58_PGPORT:'5432',
  V58_PGUSER:'postgres',
  V58_PGSSLMODE:'verify-full',
  V58_AGE_RECIPIENT:'age1egjmrjvv7g3p4rp2udc5xtz62wfndzqz2jm67xqfa5mjpvlhxfqqr6z49j',
  V58_PRODUCTION_DRIVE_FOLDER_ID:'1BI0K6xk604y2mclqC1QVcjbMgJaWHVg8',
  V58_SYNTHETIC_DRIVE_FOLDER_ID:'1hPG9jKIbCmTF6Xo1S1SUmVynug3mljEK'
});
test('all matching metadata remains only a preflight, never a backup or restore PASS',()=>{
  const result=checkCloudProductionGate(good());
  assert.equal(result.stage,'CLOUD_METADATA_PASS_ONLY');
  assert.equal(result.production_backup_created,false);
  assert.equal(result.restore_tested,false);
  assert.equal(result.environment_reviewers_verified_by_api,false);
  assert.equal(result.private_key_recovery_verified_by_runner,false);
  assert.equal(result.approved_sha,SHA);
});
test('rejects any wrong ref, wrong SHA, CI trigger, rerun, unarmed mode',()=>{
  const cases=[
    ['GITHUB_REPOSITORY','evil/fork'],
    ['GITHUB_EVENT_NAME','pull_request'],
    ['GITHUB_REF','refs/heads/feature'],
    ['GITHUB_RUN_ATTEMPT','2'],
    ['V58_REVIEWED_MAIN_SHA','b'.repeat(40)],
    ['V58_BACKUP_PROJECT_REF','wrong-project'],
    ['V58_CLOUD_BACKUP_AUTHORIZATION','MAYBE'],
    ['V58_CLOUD_PRODUCTION_BACKUP_RELEASE_ENABLED','false'],
    ['V58_MAIN_ONLY_PROTECTION_CONFIRMED','false'],
    ['V58_PRIVATE_KEY_OFFLINE_CONFIRMED','false'],
    ['V58_PGHOST','attacker.invalid'],
    ['V58_PGSSLMODE','require'],
    ['V58_AGE_RECIPIENT','age1'+ 'x'.repeat(58)],
    ['V58_PRODUCTION_DRIVE_FOLDER_ID','fake-folder-1234'],
    ['V58_SYNTHETIC_DRIVE_FOLDER_ID','fake-folder-4321']
  ];
  for(const [key,value] of cases){
    assert.throws(()=>checkCloudProductionGate({...good(),[key]:value}),key);
  }
});
test('rejects alternate database credential channels',()=>{
  for(const key of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_ACCESS_TOKEN','PGPASSWORD',
    'PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGHOSTADDR']){
    assert.throws(()=>checkCloudProductionGate({...good(),[key]:'FAKE_SECRET'}),key);
  }
});
