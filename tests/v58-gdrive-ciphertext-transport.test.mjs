import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadAndVerifyCiphertext} from '../scripts/release/v58-gdrive-ciphertext-transport.mjs';

const folder='production-folder-opaque-123456';
const name='TUTOR_V58_PG17_20261123_123456_1.age';
const oauth={clientId:'fake-client-id-123',clientSecret:'fake-client-secret-123',
  refreshToken:'fake-refresh-token-123'};
const fakeCipher=Buffer.concat([
  Buffer.from('age-encryption.org/v1\n-> X25519 test-fixture\n--- 12345\n'),
  Buffer.alloc(128,0xb6)
]);
function prepare(){
  const dir=mkdtempSync(join(tmpdir(),'v58-drive-'));
  chmodSync(dir,0o700);
  const inputPath=join(dir,'source.age'),downloadPath=join(dir,'download.age');
  writeFileSync(inputPath,fakeCipher,{mode:0o600});
  return {dir,inputPath,downloadPath};
}
function fakeDrive({maliciousUrl=false,wrongFolder=false,corrupt=false,wrongSize=false}={}){
  let calls=0,stored;
  async function request(url,opts={}){
    calls++;
    if(calls===1){
      assert.equal(url,'https://oauth2.googleapis.com/token');
      assert.equal(opts.method,'POST');
      return new Response(JSON.stringify({access_token:'FAKE_ONLY_ACCESS_TOKEN_123456'}),{status:200});
    }
    if(calls===2){
      const meta=JSON.parse(opts.body);
      assert.deepEqual(meta.parents,[folder]);
      assert.equal(meta.appProperties.delete_allowed,'false');
      assert.equal(meta.mimeType,'application/octet-stream');
      return new Response('',{status:200,headers:{location:maliciousUrl?
        'https://attacker.invalid/upload/drive/v3/files':
        'https://www.googleapis.com/upload/drive/v3/files?upload_id=fake123'}});
    }
    if(calls===3){
      assert.equal(opts.method,'PUT');
      const chunks=[];
      for await(const chunk of opts.body)chunks.push(chunk);
      stored=Buffer.concat(chunks);
      return new Response(JSON.stringify({id:'opaque-drive-file-12345'}),{status:200});
    }
    if(calls===4){
      assert.match(url,/fields=id%2Cname%2Cparents%2Csize/);
      return new Response(JSON.stringify({id:'opaque-drive-file-12345',name,
        parents:[wrongFolder?'untrusted-folder-123':folder],
        size:stored.length+(wrongSize?1:0)}),{status:200});
    }
    if(calls===5){
      assert.match(url,/\?alt=media/);
      if(corrupt)stored=Buffer.concat([stored.subarray(0,60),
        Buffer.from([stored[60]^1]),stored.subarray(61)]);
      return new Response(stored,{status:200});
    }
    throw new Error('unexpected mocked call');
  }
  return {request,get calls(){return calls}};
}
test('only age bytes travel to Drive; independent readback SHA and folder match',async()=>{
  const p=prepare(),mock=fakeDrive();
  try{
    const result=await uploadAndVerifyCiphertext({...p,folderId:folder,name,oauth,
      request:mock.request});
    assert.equal(result.status,'CIPHERTEXT_DRIVE_ROUNDTRIP_PASS');
    assert.equal(result.production_backup_restore_verified,false);
    assert.deepEqual(result.drive_mutations,['upload_only']);
    assert.match(result.ciphertext_sha256,/^[0-9a-f]{64}$/);
    assert.deepEqual(readFileSync(p.downloadPath),fakeCipher);
    assert.equal(mock.calls,5);
  }finally{rmSync(p.dir,{recursive:true,force:true})}
});
test('rejects unsafe Drive location without PUT or file creation',async()=>{
  const p=prepare(),mock=fakeDrive({maliciousUrl:true});
  try{
    await assert.rejects(()=>uploadAndVerifyCiphertext({...p,folderId:folder,name,
      oauth,request:mock.request}),/Unsafe Drive upload session URL/);
    assert.equal(mock.calls,2);
    assert.equal(existsSync(p.downloadPath),false);
  }finally{rmSync(p.dir,{recursive:true,force:true})}
});
test('Drive folder and file size mismatch both fail closed',async()=>{
  for(const config of [{wrongFolder:true},{wrongSize:true}]){
    const p=prepare();
    try{
      await assert.rejects(()=>uploadAndVerifyCiphertext({...p,folderId:folder,name,
        oauth,request:fakeDrive(config).request}),/Wrong Drive folder|Drive uploaded size mismatch/);
      assert.equal(existsSync(p.downloadPath),false);
    }finally{rmSync(p.dir,{recursive:true,force:true})}
  }
});
test('tampered Drive download fails sha256 and is never called restored',async()=>{
  const p=prepare();
  try{
    await assert.rejects(()=>uploadAndVerifyCiphertext({...p,folderId:folder,name,
      oauth,request:fakeDrive({corrupt:true}).request}),/SHA-256 mismatch/);
  }finally{rmSync(p.dir,{recursive:true,force:true})}
});
test('rejects plaintext, unsafe permissions and invalid recipient folder',async()=>{
  const p=prepare();
  try{
    writeFileSync(p.inputPath,'plain text is not an age archive',{mode:0o600});
    await assert.rejects(()=>uploadAndVerifyCiphertext({...p,folderId:folder,name,
      oauth,request:fakeDrive().request}),/Encrypted archive size invalid/);
    writeFileSync(p.inputPath,fakeCipher,{mode:0o600});chmodSync(p.inputPath,0o644);
    await assert.rejects(()=>uploadAndVerifyCiphertext({...p,folderId:folder,name,
      oauth,request:fakeDrive().request}),/owner-only/);
    chmodSync(p.inputPath,0o600);
    await assert.rejects(()=>uploadAndVerifyCiphertext({...p,folderId:'not valid',
      name,oauth,request:fakeDrive().request}),/match/);
  }finally{rmSync(p.dir,{recursive:true,force:true})}
});
