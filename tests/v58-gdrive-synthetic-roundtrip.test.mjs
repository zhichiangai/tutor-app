import {test} from 'node:test';
import assert from 'node:assert/strict';
import {driveSyntheticRoundTrip} from '../scripts/release/v58-gdrive-synthetic-roundtrip.mjs';

const ciphertext = Buffer.concat([
  Buffer.from('age-encryption.org/v1\n-> X25519 test-header\n--- abc\n'),
  Buffer.alloc(96, 0x93)
]);
const oauth = {clientId: 'client123', clientSecret: 'secret123', refreshToken: 'refresh123'};
const args = {ciphertext, folderId: 'folder_opaque123', name: 'V58_SYNTHETIC_ONLY_123456_1.age', oauth};
function mock({corrupt = false, badLocation = false} = {}) {
  let calls = 0, data = null;
  return async (url, options = {}) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(new URLSearchParams(options.body).get('refresh_token'), oauth.refreshToken);
      return new Response(JSON.stringify({access_token: 'access_token_123456'}), {status: 200});
    }
    if (calls === 2) {
      assert.match(url, /uploadType=resumable/);
      assert.equal(options.method, 'POST');
      const meta = JSON.parse(options.body);
      assert.deepEqual(meta.parents, [args.folderId]);
      assert.equal(meta.appProperties.v58_delete_allowed, 'false');
      return new Response('', {status: 200, headers: {
        location: badLocation ? 'https://evil.example/upload/drive/v3/files' :
          'https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque'
      }});
    }
    if (calls === 3) {
      assert.equal(options.method, 'PUT');
      data = Buffer.from(options.body);
      return new Response(JSON.stringify({id: 'drive_file_opaque123'}), {status: 200});
    }
    if (calls === 4) {
      assert.match(url, /files\/drive_file_opaque123\?alt=media/);
      if (corrupt) data = Buffer.from(data.map((b, i) => i === 50 ? b ^ 1 : b));
      return new Response(data, {status: 200});
    }
    throw new Error('unexpected mocked network call');
  };
}
test('synthetic encrypted content OAuth refresh, resumable upload and independent SHA download', async () => {
  const result = await driveSyntheticRoundTrip({...args, request: mock()});
  assert.equal(result.confirmed, true);
  assert.equal(result.restore_verified, false);
  assert.deepEqual(result.ciphertext, ciphertext);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test('fail closed on changed ciphertext, unsafe upload URL, plaintext and missing OAuth', async () => {
  await assert.rejects(() => driveSyntheticRoundTrip({...args, request: mock({corrupt: true})}), /SHA-256 mismatch/);
  await assert.rejects(() => driveSyntheticRoundTrip({...args, request: mock({badLocation: true})}), /URL rejected/);
  await assert.rejects(() => driveSyntheticRoundTrip({...args, ciphertext: Buffer.alloc(100), request: mock()}), /age ciphertext/);
  await assert.rejects(() => driveSyntheticRoundTrip({...args, oauth: {...oauth, refreshToken: ''}, request: mock()}), /OAuth configuration/);
});
