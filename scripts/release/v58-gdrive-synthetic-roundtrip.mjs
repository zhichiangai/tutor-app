#!/usr/bin/env node
// Synthetic-only Google Drive encrypted transfer PoC. NO Supabase DB access.
// Drive API sees only age ciphertext. This script never deletes a Drive file.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha256 = x => createHash('sha256').update(x).digest('hex');
const maxBytes = 16 * 1024 * 1024;
function ageCiphertext(buf) {
  assert.ok(Buffer.isBuffer(buf) && buf.length > 64 && buf.length <= maxBytes, 'Synthetic test ciphertext size invalid');
  assert.ok(buf.subarray(0, 22).toString('utf8').startsWith('age-encryption.org/v1'), 'Only age ciphertext allowed');
}
function checkOpaque(x) {
  assert.match(x, /^[A-Za-z0-9_-]{5,150}$/);
}
export async function driveSyntheticRoundTrip({ciphertext, folderId, name, oauth, request = fetch}) {
  ageCiphertext(ciphertext);
  checkOpaque(folderId);
  assert.match(name, /^V58_SYNTHETIC_ONLY_[0-9]{5,30}_[0-9]{1,5}\.age$/);
  for (const key of ['clientId', 'clientSecret', 'refreshToken']) {
    assert.ok(typeof oauth[key] === 'string' && oauth[key].length > 5, 'OAuth configuration incomplete');
  }
  const form = new URLSearchParams({
    client_id: oauth.clientId, client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken, grant_type: 'refresh_token'
  });
  const token = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: form.toString(),
    redirect: 'error'
  });
  if (!token.ok) throw new Error('OAuth refresh failed (details intentionally withheld)');
  const data = await token.json();
  if (typeof data.access_token !== 'string' || data.access_token.length < 10) throw new Error('OAuth response missing token');
  const authorization = 'Bearer ' + data.access_token;
  const metadata = {
    name, parents: [folderId], mimeType: 'application/octet-stream',
    appProperties: {v58_kind: 'synthetic_encrypted_poc', v58_delete_allowed: 'false'}
  };
  const session = await request(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size', {
      method: 'POST', redirect: 'error',
      headers: {
        Authorization: authorization, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(ciphertext.length)
      }, body: JSON.stringify(metadata)
    }
  );
  if (!session.ok) throw new Error('Drive upload session failed (details withheld)');
  const location = session.headers.get('location');
  if (!location) throw new Error('Drive upload session URL missing');
  const url = new URL(location);
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' ||
      !url.pathname.startsWith('/upload/drive/v3/files')) {
    throw new Error('Drive upload session URL rejected');
  }
  const uploaded = await request(url.toString(), {
    method: 'PUT', redirect: 'error',
    headers: {Authorization: authorization, 'Content-Type': 'application/octet-stream',
      'Content-Length': String(ciphertext.length)},
    body: ciphertext
  });
  if (!uploaded.ok) throw new Error('Drive upload failed (details withheld)');
  const created = await uploaded.json();
  checkOpaque(created.id);
  const downloaded = await request(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(created.id) + '?alt=media', {
      headers: {Authorization: authorization}, redirect: 'error'
    }
  );
  if (!downloaded.ok) throw new Error('Drive ciphertext download failed (details withheld)');
  const remote = Buffer.from(await downloaded.arrayBuffer());
  if (remote.length !== ciphertext.length || sha256(remote) !== sha256(ciphertext)) {
    throw new Error('Drive ciphertext SHA-256 mismatch');
  }
  return {id: created.id, bytes: ciphertext.length, sha256: sha256(remote),
    confirmed: true, ciphertext: remote, restore_verified: false};
}

const SYNTHETIC_FOLDER = 'tutor-app-v58-synthetic-only';
export async function ensureSyntheticFolder({oauth, request = fetch}) {
  for (const key of ['clientId', 'clientSecret', 'refreshToken']) {
    assert.ok(typeof oauth?.[key] === 'string' && oauth[key].length > 5, 'OAuth configuration incomplete');
  }
  const body = new URLSearchParams({
    client_id: oauth.clientId, client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken, grant_type: 'refresh_token'
  });
  const tokenResponse = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error',
    headers: {'content-type': 'application/x-www-form-urlencoded'}, body: body.toString()
  });
  if (!tokenResponse.ok) throw new Error('OAuth refresh rejected');
  const tokenData = await tokenResponse.json();
  if (typeof tokenData.access_token !== 'string' || tokenData.access_token.length < 10) {
    throw new Error('OAuth access token missing');
  }
  const authorization = 'Bearer ' + tokenData.access_token;
  const q = "name = '" + SYNTHETIC_FOLDER +
    "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const url = 'https://www.googleapis.com/drive/v3/files?fields=nextPageToken,files(id,name,mimeType)&pageSize=100&q=' +
    encodeURIComponent(q);
  const listed = await request(url, {headers: {Authorization: authorization}, redirect: 'error'});
  if (!listed.ok) throw new Error('Drive synthetic folder lookup failed');
  const found = await listed.json();
  if (!Array.isArray(found.files) || found.nextPageToken) throw new Error('Drive folder lookup incomplete');
  if (found.files.length > 1) throw new Error('More than one app-visible synthetic folder; manual review required');
  if (found.files.length === 1) {
    const x = found.files[0];
    checkOpaque(x.id);
    if (x.name !== SYNTHETIC_FOLDER || x.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('Existing folder did not pass validation');
    }
    return {folderId: x.id, reused: true};
  }
  const metadata = {
    name: SYNTHETIC_FOLDER, mimeType: 'application/vnd.google-apps.folder',
    appProperties: {v58_kind: 'synthetic_folder_only', v58_delete_allowed: 'false'}
  };
  const created = await request('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType', {
    method: 'POST', redirect: 'error',
    headers: {Authorization: authorization, 'Content-Type': 'application/json; charset=UTF-8'},
    body: JSON.stringify(metadata)
  });
  if (!created.ok) throw new Error('Drive synthetic folder create failed');
  const folder = await created.json();
  checkOpaque(folder.id);
  if (folder.name !== SYNTHETIC_FOLDER || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('Created folder failed validation');
  }
  return {folderId: folder.id, reused: false};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    const oauth = {
      clientId: process.env.GDRIVE_CLIENT_ID,
      clientSecret: process.env.GDRIVE_CLIENT_SECRET,
      refreshToken: process.env.GDRIVE_REFRESH_TOKEN
    };
    if (process.env.V58_DRIVE_MODE === 'synthetic-folder-bootstrap') {
      assert.equal(process.argv.length, 2, 'Bootstrap accepts no files');
      const folder = await ensureSyntheticFolder({oauth});
      process.stdout.write(JSON.stringify({status: 'SYNTHETIC_FOLDER_READY',
        folder_id: folder.folderId, reused: folder.reused, production_backup: false}) + '\n');
    } else {
      assert.equal(process.env.V58_DRIVE_MODE, 'synthetic-only');
      assert.equal(process.argv.length, 3, 'Expected one age synthetic fixture path');
    const result = await driveSyntheticRoundTrip({
      ciphertext: readFileSync(resolve(process.argv[2])),
      folderId: process.env.GDRIVE_FOLDER_ID,
      name: 'V58_SYNTHETIC_ONLY_' + process.env.GITHUB_RUN_ID + '_' + process.env.GITHUB_RUN_ATTEMPT + '.age',
      oauth
    });
    const path = process.env.V58_SYNTHETIC_DOWNLOAD_PATH;
    assert.ok(path && path.startsWith('/tmp/'), 'Only ephemeral /tmp path permitted');
    writeFileSync(path, result.ciphertext, {flag: 'wx', mode: 0o600});
    process.stdout.write(JSON.stringify({status: 'SYNTHETIC_DRIVE_CIPHERTEXT_SHA256_PASS',
      bytes: result.bytes, sha256: result.sha256, drive_id: result.id,
      restore_verified: false, production_backup: false}) + '\n');
    }
  } catch {
    process.stderr.write('NO_GO: Google Drive synthetic-only upload/download verification failed\n');
    process.exitCode = 2;
  }
}
