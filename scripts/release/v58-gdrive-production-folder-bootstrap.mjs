#!/usr/bin/env node
// V5.8: one-time empty Google Drive production-backup FOLDER bootstrap.
// Uses the existing synthetic OAuth environment for this *folder operation only*.
// NO Production DB access, NO uploads of any backup, NO Drive deletes or sharing.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FOLDER_NAME = 'tutor-app-v58-production-encrypted-backups';
const SYNTHETIC_NAME = 'tutor-app-v58-synthetic-only';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KIND = 'production_encrypted_backup_folder';
const OPAQUE_ID = /^[A-Za-z0-9_-]{5,150}$/;

async function jsonResponse(response, failure) {
  if (!response.ok) throw new Error(failure);
  return response.json();
}

export async function ensureProductionEncryptedFolder({oauth, syntheticFolderId, request = fetch}) {
  assert.match(syntheticFolderId ?? '', OPAQUE_ID, 'Synthetic folder ID missing');
  for (const key of ['clientId', 'clientSecret', 'refreshToken']) {
    assert.ok(typeof oauth?.[key] === 'string' && oauth[key].length > 5,
      'Dedicated Drive OAuth configuration incomplete');
  }
  const form = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: 'refresh_token'
  });
  const tokenResponse = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: form.toString(), redirect: 'error'
  });
  const token = await jsonResponse(tokenResponse, 'OAuth refresh unavailable');
  assert.ok(typeof token.access_token === 'string' && token.access_token.length > 10,
    'OAuth access token missing');
  const headers = {Authorization: 'Bearer ' + token.access_token};

  // Confirm we are using the SAME app-accessible synthetic folder as the prior test.
  const syntheticResponse = await request(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(syntheticFolderId) +
    '?fields=id%2Cname%2CmimeType%2Ctrashed', {method: 'GET', headers, redirect: 'error'}
  );
  const synthetic = await jsonResponse(syntheticResponse, 'Synthetic folder access unavailable');
  assert.equal(synthetic.id, syntheticFolderId);
  assert.equal(synthetic.name, SYNTHETIC_NAME);
  assert.equal(synthetic.mimeType, FOLDER_MIME);
  assert.notEqual(synthetic.trashed, true);

  const query = "name = '" + FOLDER_NAME + "' and mimeType = '" + FOLDER_MIME +
    "' and trashed = false";
  const listUrl = 'https://www.googleapis.com/drive/v3/files?fields=' +
    encodeURIComponent('nextPageToken,files(id,name,mimeType,appProperties,trashed)') +
    '&pageSize=100&q=' + encodeURIComponent(query);
  const list = await jsonResponse(await request(listUrl, {
    method: 'GET', headers, redirect: 'error'
  }), 'Production backup folder lookup failed');
  assert.ok(Array.isArray(list.files) && !list.nextPageToken,
    'Production backup folder lookup incomplete');
  assert.ok(list.files.length <= 1,
    'Duplicate app-visible production folders; manual review required');
  if (list.files.length === 1) {
    const existing = list.files[0];
    assert.match(existing.id ?? '', OPAQUE_ID);
    assert.notEqual(existing.id, syntheticFolderId, 'Synthetic and production folder collision');
    assert.equal(existing.name, FOLDER_NAME);
    assert.equal(existing.mimeType, FOLDER_MIME);
    assert.equal(existing.appProperties?.v58_kind, KIND,
      'Same-named folder was not created by the reviewed bootstrap');
    return {id: existing.id, created: false, synthetic_separate: true,
      production_backup_uploaded: false, production_db_accessed: false};
  }

  const meta = {
    name: FOLDER_NAME, mimeType: FOLDER_MIME,
    appProperties: {v58_kind: KIND, v58_delete_allowed: 'false'}
  };
  const create = await jsonResponse(await request(
    'https://www.googleapis.com/drive/v3/files?ignoreDefaultVisibility=true&fields=' +
    encodeURIComponent('id,name,mimeType,appProperties'), {
      method: 'POST', headers: {...headers, 'content-type': 'application/json; charset=UTF-8'},
      body: JSON.stringify(meta), redirect: 'error'
    }
  ), 'Production backup folder creation failed');
  assert.match(create.id ?? '', OPAQUE_ID);
  assert.notEqual(create.id, syntheticFolderId);
  assert.equal(create.name, FOLDER_NAME);
  assert.equal(create.mimeType, FOLDER_MIME);
  assert.equal(create.appProperties?.v58_kind, KIND);

  const readback = await jsonResponse(await request(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(create.id) +
    '?fields=id%2Cname%2CmimeType%2CappProperties%2Ctrashed', {
      method: 'GET', headers, redirect: 'error'
    }
  ), 'Created production backup folder is not readable by OAuth app');
  assert.equal(readback.id, create.id);
  assert.equal(readback.name, FOLDER_NAME);
  assert.equal(readback.mimeType, FOLDER_MIME);
  assert.equal(readback.appProperties?.v58_kind, KIND);
  assert.notEqual(readback.trashed, true);
  return {id: create.id, created: true, synthetic_separate: true,
    production_backup_uploaded: false, production_db_accessed: false};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(process.env.V58_DRIVE_EMPTY_FOLDER_ACK, 'CREATE_EMPTY_FOLDER_ONLY');
    assert.equal(process.argv.length, 2, 'No file paths permitted');
    for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN',
      'PGPASSWORD', 'PGPASSFILE', 'V58_PROD_PGPASS_LINE']) {
      assert.ok(!process.env[key], 'No production database credentials allowed');
    }
    const result = await ensureProductionEncryptedFolder({
      syntheticFolderId: process.env.GDRIVE_SYNTHETIC_FOLDER_ID,
      oauth: {
        clientId: process.env.GDRIVE_CLIENT_ID,
        clientSecret: process.env.GDRIVE_CLIENT_SECRET,
        refreshToken: process.env.GDRIVE_REFRESH_TOKEN
      }
    });
    process.stdout.write(JSON.stringify({
      status: 'PRODUCTION_ENCRYPTED_BACKUP_FOLDER_READY',
      production_folder_id: result.id,
      created: result.created,
      synthetic_folder_separate: result.synthetic_separate,
      production_backup_uploaded: false,
      production_database_accessed: false
    }) + '\n');
  } catch {
    process.stderr.write('NO_GO: empty encrypted production Drive folder bootstrap failed\n');
    process.exitCode = 2;
  }
}
