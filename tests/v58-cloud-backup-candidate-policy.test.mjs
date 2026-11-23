import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/v58-cloud-backup-candidate-synthetic.yml', import.meta.url), 'utf8');
const synthetic = new URL('./local/v58-gdrive-encrypted-backup-poc.sh', import.meta.url).pathname;

test('cloud-first candidate cannot receive privileged secrets, deploy, schedule or run on pull_request_target', () => {
  assert.match(workflow, /^on:\n  pull_request:/m);
  assert.match(workflow, /^permissions:\n  contents: read/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /V58_CLOUD_BACKUP_MODE: 'synthetic-only'/);
  assert.match(workflow, /SYNTHETIC_ONLY/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /\b(pull_request_target|schedule|production-backup|environment:|secrets\.|vars\.|PGPASSWORD|PGPASSFILE|DATABASE_URL|SUPABASE_DB_URL|workflow_run|artifact)\b/i);
  assert.doesNotMatch(workflow, /\b(supabase db push|migration repair|pg_dump --dbname|rm -rf \/home)\b/i);
});

test('synthetic script rejects fake Production credential variables before touching Docker or networking', () => {
  for (const secret of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_URL','DATABASE_URL','PGPASSWORD','PGPASSFILE','GDRIVE_REFRESH_TOKEN','AGE_SECRET_KEY']) {
    const result = spawnSync('bash',[synthetic],{
      env:{PATH:process.env.PATH || '/usr/bin:/bin',CI:'true',GITHUB_ACTIONS:'true',[secret]:'FAKE_SYNTHETIC_CREDENTIAL_DO_NOT_USE'},
      encoding:'utf8',timeout:10000
    });
    assert.equal(result.status,2,secret+' should be rejected');
    assert.match(result.stderr,/REFUSED: no real secrets in the synthetic PoC/);
    assert.doesNotMatch(result.stdout+result.stderr,/FAKE_SYNTHETIC_CREDENTIAL_DO_NOT_USE/);
  }
});

test('synthetic script rejects execution outside CI before accessing any host tools', () => {
  const result=spawnSync('bash',[synthetic],{
    env:{PATH:process.env.PATH || '/usr/bin:/bin',CI:'',GITHUB_ACTIONS:''},
    encoding:'utf8',timeout:10000
  });
  assert.equal(result.status,2);
  assert.match(result.stderr,/REFUSED: synthetic GitHub CI only/);
});
