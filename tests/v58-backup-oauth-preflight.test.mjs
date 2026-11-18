import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  assessOAuthPolicy,
  assessProductionMetadata,
  probeSyntheticDriveReadOnly
} from '../scripts/release/v58-backup-oauth-preflight.mjs';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const goodMetadata = () => ({
  projectRef: 'vctisuglfoxyuwlvyjee',
  envName: 'v58-production-backup',
  mainOnlyConfirmed: true,
  pgHost: 'db.vctisuglfoxyuwlvyjee.supabase.co',
  pgPort: '5432',
  pgUser: 'postgres',
  pgSslMode: 'verify-full',
  ageRecipient: 'age1' + 'q'.repeat(58),
  driveFolderId: '1BI0K6xk604y2mclqC1QVcjbMgJaWHVg8',
  syntheticFolderId: '1hPG9jKIbCmTF6Xo1S1SUmVynug3mljEK',
  privateKeyOfflineConfirmed: true
});

test('External + Testing is a hard long-term OAuth NO-GO despite current access', () => {
  const outcome = assessOAuthPolicy({
    userType: 'External', publishingStatus: 'Testing', scope: DRIVE_SCOPE
  });
  assert.equal(outcome.policy_candidate, false);
  assert.ok(outcome.issues.includes('EXTERNAL_TESTING_REFRESH_TOKEN_7_DAY_RISK'));
  assert.equal(outcome.durable_refresh_token_verified, false);
});

test('Internal candidate requires same Workspace owner; external published is only candidate', () => {
  assert.equal(assessOAuthPolicy({
    userType: 'Internal', workspaceOwnerConfirmed: false, scope: DRIVE_SCOPE
  }).policy_candidate, false);
  const internal = assessOAuthPolicy({
    userType: 'Internal', workspaceOwnerConfirmed: true, scope: DRIVE_SCOPE
  });
  assert.equal(internal.policy_candidate, true);
  assert.equal(internal.durable_refresh_token_verified, false);
  const published = assessOAuthPolicy({
    userType: 'External', publishingStatus: 'In production', scope: DRIVE_SCOPE
  });
  assert.equal(published.policy_candidate, true);
  assert.equal(published.production_backup_authorized, false);
  assert.equal(assessOAuthPolicy({
    userType: 'External', publishingStatus: 'In production',
    scope: 'https://www.googleapis.com/auth/drive'
  }).policy_candidate, false);
});

test('Production metadata has strict project, PG17 host, TLS, age and folder separation', () => {
  assert.equal(assessProductionMetadata(goodMetadata()).metadata_pass, true);
  const wrong = {...goodMetadata(), driveFolderId: goodMetadata().syntheticFolderId};
  assert.ok(assessProductionMetadata(wrong).issues.includes(
    'PRODUCTION_AND_SYNTHETIC_FOLDERS_MUST_DIFFER'
  ));
  const noTls = {...goodMetadata(), pgSslMode: 'disable'};
  assert.ok(assessProductionMetadata(noTls).issues.includes('TLS_HOSTNAME_VERIFICATION_REQUIRED'));
  const wrongHost = {...goodMetadata(), pgHost: 'db.otherproject.supabase.co'};
  assert.ok(assessProductionMetadata(wrongHost).issues.includes('UNAPPROVED_DATABASE_HOST'));
  assert.equal(assessProductionMetadata({
    ...goodMetadata(), mainOnlyConfirmed: false
  }).metadata_pass, false);
  const switchedToOtherValidFolder = assessProductionMetadata({
    ...goodMetadata(), driveFolderId: '1BI0K6xk604y2mclqC1QVcjbMgJaWHVg9'
  });
  assert.equal(switchedToOtherValidFolder.metadata_pass, false);
  assert.ok(switchedToOtherValidFolder.issues.includes(
    'PRODUCTION_DRIVE_FOLDER_ID_NOT_BOOTSTRAP_VERIFIED'
  ));
  const replacedSynthetic = assessProductionMetadata({
    ...goodMetadata(), syntheticFolderId: '1hPG9jKIbCmTF6Xo1S1SUmVynug3mljEL'
  });
  assert.equal(replacedSynthetic.metadata_pass, false);
  assert.ok(replacedSynthetic.issues.includes('SYNTHETIC_DRIVE_FOLDER_ID_NOT_RESTORE_VERIFIED'));
});

test('Even complete metadata never authorizes Production backup or claims restore', () => {
  const result = assessProductionMetadata(goodMetadata());
  assert.equal(result.metadata_pass, true);
  assert.equal(result.production_connection_attempted, false);
  assert.equal(result.credentials_inspected, false);
  assert.equal(result.production_backup_created, false);
  assert.equal(result.restore_tested, false);
  assert.equal(result.environment_protection_api_verified, false);
  assert.equal(result.private_key_recovery_evidence_verified, false);
  assert.equal(result.actual_drive_folder_access_probed, false);
  assert.equal(result.production_backup_authorized, false);
});

test('Synthetic probe only refreshes OAuth and GETs its existing folder', async () => {
  const seen = [];
  const folderId = 'synthetic-folder-safe-1234567';
  const fakeToken = 'FAKE_ACCESS_TOKEN_DO_NOT_LOG';
  const request = async (url, options) => {
    seen.push({url, method: options.method});
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      return new Response(JSON.stringify({access_token: fakeToken}), {status: 200});
    }
    assert.equal(options.method, 'GET');
    assert.match(url, /drive\/v3\/files\//);
    assert.equal(options.headers.Authorization, 'Bearer ' + fakeToken);
    return new Response(JSON.stringify({
      id: folderId, name: 'tutor-app-v58-synthetic-only',
      mimeType: 'application/vnd.google-apps.folder'
    }), {status: 200});
  };
  const actual = await probeSyntheticDriveReadOnly({
    oauth: {clientId: 'fake-client-123', clientSecret: 'fake-secret-123',
      refreshToken: 'fake-refresh-123'},
    folderId, request
  });
  assert.equal(actual.oauth_refresh_now, 'PASS');
  assert.equal(actual.synthetic_drive_folder_read, 'PASS');
  assert.equal(actual.long_term_token_validity, 'NOT_VERIFIED');
  assert.equal(actual.drive_mutations, 0);
  assert.deepEqual(seen.map(x => x.method), ['POST', 'GET']);
});

test('Synthetic probe fails closed on invalid folder and unavailable OAuth', async () => {
  const oauth = {clientId: 'fake-client-123', clientSecret: 'fake-secret-123',
    refreshToken: 'fake-refresh-123'};
  await assert.rejects(probeSyntheticDriveReadOnly({
    oauth, folderId: 'bad id', request: async () => {throw Error('Should not fetch');}
  }), /Invalid synthetic folder ID/);
  const failure = probeSyntheticDriveReadOnly({
    oauth, folderId: 'synthetic-folder-safe-1234567',
    request: async () => new Response(JSON.stringify({error: 'invalid_grant'}), {status: 400})
  });
  await assert.rejects(failure, /OAuth refresh unavailable/);
});
