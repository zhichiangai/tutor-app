import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workflow=readFileSync(new URL('../.github/workflows/v58-cloud-production-backup-candidate.yml',import.meta.url),'utf8');
const backup=readFileSync(new URL('../scripts/release/v58-cloud-production-backup-once.sh',import.meta.url),'utf8');
const backupPath=fileURLToPath(new URL('../scripts/release/v58-cloud-production-backup-once.sh',import.meta.url));
const active=workflow.split('\n').filter(x=>!x.trimStart().startsWith('#')).join('\n');

test('candidate has a single MANUAL trigger and protected Environment',()=>{
  assert.match(active,/^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(active,/^\s*(pull_request|pull_request_target|schedule|push|workflow_run):/m);
  assert.match(active,/^\s+environment: v58-production-backup$/m);
  assert.match(active,/^permissions:\n  contents: read$/m);
  assert.match(active,/github\.ref == 'refs\/heads\/main'/);
  assert.match(active,/github\.repository == 'zhichiangai\/tutor-app'/);
  assert.match(active,/V58_REVIEWED_MAIN_SHA: \$\{\{ vars\.V58_REVIEWED_MAIN_SHA \}\}/);
  assert.match(active,/V58_CLOUD_PRODUCTION_BACKUP_RELEASE_ENABLED: \$\{\{ vars\.V58_CLOUD_PRODUCTION_BACKUP_RELEASE_ENABLED \}\}/);
  assert.match(active,/persist-credentials: false/);
  assert.doesNotMatch(active,/uses: .*@(main|master|latest)\b/);
});
test('only protected manual steps can see credentials; never cache or upload artifact',()=>{
  assert.match(active,/V58_SECRET_DB_PASSWORD: \$\{\{ secrets\.V58_BACKUP_DB_PASSWORD \}\}/);
  assert.match(active,/GDRIVE_REFRESH_TOKEN: \$\{\{ secrets\.V58_GDRIVE_REFRESH_TOKEN \}\}/);
  assert.doesNotMatch(active,/(\bupload-artifact@|\bcache@|actions\/download-artifact|supabase db push|migration repair|curl.*-d.*password)/);
  assert.match(active,/Scrub ephemeral runner scratch/);
  assert.match(backup,/v58-cloud-production-gate\.mjs/);
  assert.match(backup,/v58-pg17-credential-guard\.mjs/);
  assert.match(backup,/pg_dump --format=custom/);
  assert.match(backup,/pg_dumpall --globals-only --no-role-passwords/);
  assert.match(backup,/rm -f -- "\$V58_RUN_PRIVATE_DIR\/plain-archive\.tar"/);
  assert.match(backup,/v58-gdrive-ciphertext-transport\.mjs/);
  assert.doesNotMatch(backup,/\b(supabase db push|supabase db reset|DROP TABLE|DELETE FROM|pg_restore --clean)\b/i);
});
test('executor fails closed without approved GitHub metadata; never reaches DB',()=>{
  const p=spawnSync('bash',[backupPath],{
    env:{PATH:process.env.PATH||'/usr/bin:/bin',GITHUB_ACTIONS:'true',
      GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/heads/main'},
    encoding:'utf8',timeout:8000
  });
  assert.equal(p.status,2);
  assert.match(p.stderr,/NO_GO/);
  assert.doesNotMatch(p.stdout+p.stderr,/password|token|refresh_token/i);
});
