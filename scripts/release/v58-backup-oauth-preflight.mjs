#!/usr/bin/env node
// V5.8: metadata-only production backup readiness and read-only synthetic Drive OAuth probe.
// NO production DB access, NO Google Drive write/delete, NO secret output.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const PROJECT = 'vctisuglfoxyuwlvyjee';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SYNTHETIC_NAME = 'tutor-app-v58-synthetic-only';
const OPAQUE_ID = /^[A-Za-z0-9_-]{5,150}$/;
const AGE_RECIPIENT = /^age1[a-z0-9]{30,100}$/;

export function assessOAuthPolicy(input) {
  const issues = [];
  if (input.scope !== SCOPE) issues.push('OAUTH_SCOPE_NOT_DRIVE_FILE_ONLY');
  if (input.userType === 'External' && input.publishingStatus === 'Testing') {
    issues.push('EXTERNAL_TESTING_REFRESH_TOKEN_7_DAY_RISK');
  } else if (input.userType === 'Internal') {
    if (input.workspaceOwnerConfirmed !== true) {
      issues.push('INTERNAL_WORKSPACE_OWNERSHIP_NOT_CONFIRMED');
    }
  } else if (input.userType === 'External' && input.publishingStatus === 'In production') {
    // Candidate only: a successful short-lived probe does not prove token durability.
  } else {
    issues.push('OAUTH_CONSOLE_PUBLISHING_STATE_NOT_VERIFIED');
  }
  return {
    policy_candidate: issues.length === 0,
    issues,
    durable_refresh_token_verified: false,
    production_backup_authorized: false
  };
}

export function assessProductionMetadata(input) {
  const issues = [];
  if (input.projectRef !== PROJECT) issues.push('WRONG_SUPABASE_PROJECT');
  if (input.envName !== 'v58-production-backup') issues.push('WRONG_ENVIRONMENT');
  if (input.mainOnlyConfirmed !== true) issues.push('MAIN_ONLY_PROTECTION_UNCONFIRMED');
  if (input.pgHost !== 'db.' + PROJECT + '.supabase.co') issues.push('UNAPPROVED_DATABASE_HOST');
  if (input.pgUser !== 'postgres' || input.pgPort !== '5432') issues.push('UNAPPROVED_DATABASE_USER_OR_PORT');
  if (input.pgSslMode !== 'verify-full') issues.push('TLS_HOSTNAME_VERIFICATION_REQUIRED');
  if (typeof input.ageRecipient !== 'string' || !AGE_RECIPIENT.test(input.ageRecipient)) {
    issues.push('AGE_PUBLIC_RECIPIENT_MISSING_OR_INVALID');
  }
  if (typeof input.driveFolderId !== 'string' || !OPAQUE_ID.test(input.driveFolderId)) {
    issues.push('PRODUCTION_DRIVE_FOLDER_UNVERIFIED');
  }
  if (typeof input.syntheticFolderId !== 'string' || !OPAQUE_ID.test(input.syntheticFolderId)) {
    issues.push('SYNTHETIC_DRIVE_FOLDER_UNVERIFIED');
  } else if (input.driveFolderId === input.syntheticFolderId) {
    issues.push('PRODUCTION_AND_SYNTHETIC_FOLDERS_MUST_DIFFER');
  }
  if (input.privateKeyOfflineConfirmed !== true) issues.push('OFFLINE_RECOVERY_KEY_NOT_CONFIRMED');
  return {
    metadata_pass: issues.length === 0,
    issues,
    production_connection_attempted: false,
    credentials_inspected: false,
    production_backup_created: false,
    restore_tested: false,
    environment_protection_api_verified: false
  };
}

export async function probeSyntheticDriveReadOnly({oauth, folderId, request = fetch}) {
  assert.ok(OPAQUE_ID.test(folderId || ''), 'Invalid synthetic folder ID');
  for (const key of ['clientId', 'clientSecret', 'refreshToken']) {
    assert.ok(typeof oauth?.[key] === 'string' && oauth[key].length > 5, 'OAuth configuration missing');
  }
  const params = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: 'refresh_token'
  });
  const tokenResponse = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: params.toString(),
    redirect: 'error'
  });
  if (!tokenResponse.ok) throw new Error('OAuth refresh unavailable');
  const tokenData = await tokenResponse.json();
  if (typeof tokenData.access_token !== 'string' || tokenData.access_token.length < 10) {
    throw new Error('OAuth access token unavailable');
  }
  const folderResponse = await request(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId) +
      '?fields=id%2Cname%2CmimeType', {
      method: 'GET',
      headers: {Authorization: 'Bearer ' + tokenData.access_token},
      redirect: 'error'
    }
  );
  if (!folderResponse.ok) throw new Error('Synthetic Drive folder read unavailable');
  const folder = await folderResponse.json();
  if (folder?.id !== folderId || folder?.name !== SYNTHETIC_NAME ||
      folder?.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('Synthetic Drive folder identity mismatch');
  }
  return {
    oauth_refresh_now: 'PASS',
    synthetic_drive_folder_read: 'PASS',
    drive_mutations: 0,
    production_db_access: false,
    long_term_token_validity: 'NOT_VERIFIED'
  };
}

function assertManualMain(expected) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.V58_READINESS_OPERATION, expected);
  for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN',
    'PGPASSWORD', 'PGPASSFILE', 'V58_PROD_PGPASS_LINE']) {
    assert.ok(!process.env[key], 'Production credential environment prohibited in readiness probe');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2];
  try {
    if (operation === 'synthetic-oauth-readonly') {
      assertManualMain('SYNTHETIC_OAUTH_READONLY');
      const result = await probeSyntheticDriveReadOnly({
        oauth: {
          clientId: process.env.GDRIVE_CLIENT_ID,
          clientSecret: process.env.GDRIVE_CLIENT_SECRET,
          refreshToken: process.env.GDRIVE_REFRESH_TOKEN
        },
        folderId: process.env.GDRIVE_FOLDER_ID
      });
      process.stdout.write(JSON.stringify(result) + '\n');
      process.stdout.write('POLICY_CHECK_REQUIRED: this proves current access, NOT a durable refresh token\n');
    } else if (operation === 'production-metadata') {
      assertManualMain('PRODUCTION_ENV_METADATA');
      const result = assessProductionMetadata({
        projectRef: process.env.V58_BACKUP_PROJECT_REF,
        envName: 'v58-production-backup',
        mainOnlyConfirmed: process.env.V58_MAIN_ONLY_PROTECTION_CONFIRMED === 'true',
        pgHost: process.env.V58_PGHOST,
        pgPort: process.env.V58_PGPORT,
        pgUser: process.env.V58_PGUSER,
        pgSslMode: process.env.V58_PGSSLMODE,
        ageRecipient: process.env.V58_AGE_RECIPIENT,
        driveFolderId: process.env.V58_PRODUCTION_DRIVE_FOLDER_ID,
        syntheticFolderId: process.env.V58_SYNTHETIC_DRIVE_FOLDER_ID,
        privateKeyOfflineConfirmed: process.env.V58_PRIVATE_KEY_OFFLINE_CONFIRMED === 'true'
      });
      process.stdout.write(JSON.stringify(result) + '\n');
      if (!result.metadata_pass) process.exitCode = 2;
    } else {
      throw new Error('Invalid operation');
    }
  } catch {
    process.stderr.write('NO_GO: V5.8 backup OAuth/readiness check failed; no secrets emitted\n');
    process.exitCode = 2;
  }
}
