#!/usr/bin/env node
// RAP-16 candidate only: fail-closed metadata gate for one manual cloud backup.
// This module never reads DB content, checks key files, or grants authorization.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const REF='vctisuglfoxyuwlvyjee';
const AGE='age1egjmrjvv7g3p4rp2udc5xtz62wfndzqz2jm67xqfa5mjpvlhxfqqr6z49j';
const FOLDER='1BI0K6xk604y2mclqC1QVcjbMgJaWHVg8';
const SYNTHETIC='1hPG9jKIbCmTF6Xo1S1SUmVynug3mljEK';
const SHA=/^[a-f0-9]{40}$/;
export function checkCloudProductionGate(e){
  const require=(name,value)=>assert.equal(e[name],value,name+' mismatch');
  require('GITHUB_ACTIONS','true');
  require('GITHUB_REPOSITORY','zhichiangai/tutor-app');
  require('GITHUB_EVENT_NAME','workflow_dispatch');
  require('GITHUB_REF','refs/heads/main');
  require('GITHUB_RUN_ATTEMPT','1');
  require('V58_BACKUP_PROJECT_REF',REF);
  require('V58_CLOUD_BACKUP_AUTHORIZATION','ONE_TIME_PRODUCTION_READ_ONLY_BACKUP');
  require('V58_BACKUP_EXECUTION_MODE','ENCRYPTED_DRIVE_ONCE');
  require('V58_CLOUD_PRODUCTION_BACKUP_RELEASE_ENABLED','true');
  require('V58_MAIN_ONLY_PROTECTION_CONFIRMED','true');
  require('V58_PRIVATE_KEY_OFFLINE_CONFIRMED','true');
  require('V58_PGHOST','db.'+REF+'.supabase.co');
  require('V58_PGPORT','5432');
  require('V58_PGUSER','postgres');
  require('V58_PGSSLMODE','verify-full');
  require('V58_AGE_RECIPIENT',AGE);
  require('V58_PRODUCTION_DRIVE_FOLDER_ID',FOLDER);
  require('V58_SYNTHETIC_DRIVE_FOLDER_ID',SYNTHETIC);
  assert.match(e.GITHUB_SHA||'',SHA,'GitHub SHA missing');
  assert.equal(e.V58_REVIEWED_MAIN_SHA,e.GITHUB_SHA,
    'Runner SHA must equal the independently reviewed Main SHA');
  for(const unsafe of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_ACCESS_TOKEN',
    'PGPASSWORD','PGHOSTADDR','PGOPTIONS','PGSERVICE','PGSERVICEFILE']){
    assert.ok(!e[unsafe],'Unsupported database credential route');
  }
  // These flags are operator declarations, NOT independently verified
  // Environment reviewers, key recovery, Drive access or Production SQL approval.
  return {stage:'CLOUD_METADATA_PASS_ONLY',production_backup_created:false,
    restore_tested:false,environment_reviewers_verified_by_api:false,
    private_key_recovery_verified_by_runner:false,
    approved_sha:e.GITHUB_SHA};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assert.equal(process.argv.length,2);
    process.stdout.write(JSON.stringify(checkCloudProductionGate(process.env))+'\n');
  }catch{
    process.stderr.write('NO_GO: Cloud Production Backup authorization metadata failed\n');
    process.exitCode=2;
  }
}
