import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLDER_NAME, ensureProductionEncryptedFolder
} from '../scripts/release/v58-gdrive-production-folder-bootstrap.mjs';

const syntheticId = 'synthetic-safe-opaque-00001';
const oauth = {clientId: 'mock-client-id-12345', clientSecret: 'mock-client-secret-12345',
  refreshToken: 'mock-refresh-token-12345'};
const mime = 'application/vnd.google-apps.folder';
const kind = 'production_encrypted_backup_folder';
const goodFolder = id => ({
  id, name: FOLDER_NAME, mimeType: mime, appProperties: {v58_kind: kind},
  trashed: false
});
const response = (body, status=200) => new Response(JSON.stringify(body), {status});
function createMock({existing=null, failToken=false, duplicate=false, wrongReadback=false}={}) {
  const calls=[];
  async function request(url, opts) {
    const u = new URL(url);
    calls.push({host:u.hostname, path:u.pathname, method:opts.method, query:u.searchParams, body:opts.body});
    if (u.hostname === 'oauth2.googleapis.com') {
      assert.equal(opts.method, 'POST');
      return failToken?response({error:'invalid_grant'},400):response({access_token:'mock-access-token-for-tests'});
    }
    assert.equal(u.hostname, 'www.googleapis.com');
    if (u.pathname.endsWith('/' + syntheticId)) {
      assert.equal(opts.method, 'GET');
      return response({id:syntheticId,name:'tutor-app-v58-synthetic-only',mimeType:mime,trashed:false});
    }
    if (u.pathname.endsWith('/' + 'prod-created-opaque-12345')) {
      assert.equal(opts.method, 'GET');
      return response(wrongReadback ? {...goodFolder('prod-created-opaque-12345'),name:'spoof'} :
        goodFolder('prod-created-opaque-12345'));
    }
    if (u.pathname.endsWith('/files') && opts.method === 'GET') {
      assert.match(u.searchParams.get('q')||'', /tutor-app-v58-production-encrypted-backups/);
      return response({files:duplicate ?
        [goodFolder('prod-duplicate-00001'),goodFolder('prod-duplicate-00002')] :
        (existing ? [existing] : [])});
    }
    if (u.pathname.endsWith('/files') && opts.method === 'POST') {
      assert.equal(u.searchParams.get('ignoreDefaultVisibility'),'true');
      const meta=JSON.parse(opts.body);
      assert.equal(meta.name,FOLDER_NAME);
      assert.equal(meta.appProperties.v58_delete_allowed,'false');
      return response(goodFolder('prod-created-opaque-12345'));
    }
    throw new Error('Unexpected URL: '+u.pathname);
  }
  return {request,calls};
}

test('creates only a new empty folder with exact marker, then verifies Drive readback',async()=>{
  const m=createMock();
  const r=await ensureProductionEncryptedFolder({oauth,syntheticFolderId:syntheticId,request:m.request});
  assert.equal(r.created,true);
  assert.equal(r.id,'prod-created-opaque-12345');
  assert.equal(r.synthetic_separate,true);
  assert.equal(r.production_backup_uploaded,false);
  assert.equal(r.production_db_accessed,false);
  assert.deepEqual(m.calls.map(c=>c.method),['POST','GET','GET','POST','GET']);
  assert.equal(m.calls.filter(c=>c.method==='POST'&&c.host==='www.googleapis.com').length,1);
  assert.equal(m.calls.filter(c=>c.method==='DELETE'||c.method==='PUT'||c.method==='PATCH').length,0);
});

test('reuses ONLY marked existing production folder without creating or uploading',async()=>{
  const m=createMock({existing:goodFolder('existing-production-0001')});
  const r=await ensureProductionEncryptedFolder({oauth,syntheticFolderId:syntheticId,request:m.request});
  assert.equal(r.created,false);
  assert.equal(r.id,'existing-production-0001');
  assert.deepEqual(m.calls.map(c=>c.method),['POST','GET','GET']);
});

test('fails closed for spoofed or duplicate folder; never POST creates',async()=>{
  for(const x of [
    {existing:{...goodFolder('existing-production-0001'),appProperties:{}}},
    {duplicate:true}
  ]) {
    const m=createMock(x);
    await assert.rejects(ensureProductionEncryptedFolder({
      oauth,syntheticFolderId:syntheticId,request:m.request
    }));
    assert.equal(m.calls.filter(c=>c.method==='POST'&&c.host==='www.googleapis.com').length,0);
  }
});

test('fails closed if OAuth expires or folder readback differs',async()=>{
  const fail=createMock({failToken:true});
  await assert.rejects(ensureProductionEncryptedFolder({
    oauth,syntheticFolderId:syntheticId,request:fail.request
  }),/OAuth refresh unavailable/);
  const mismatch=createMock({wrongReadback:true});
  await assert.rejects(ensureProductionEncryptedFolder({
    oauth,syntheticFolderId:syntheticId,request:mismatch.request
  }),/Expected values to be strictly equal|strictly equal/);
});

test('rejects missing token fields or a malformed synthetic folder ID',async()=>{
  await assert.rejects(ensureProductionEncryptedFolder({oauth,syntheticFolderId:'',request:createMock().request}));
  await assert.rejects(ensureProductionEncryptedFolder({
    oauth:{...oauth,refreshToken:''},syntheticFolderId:syntheticId,request:createMock().request
  }));
});
