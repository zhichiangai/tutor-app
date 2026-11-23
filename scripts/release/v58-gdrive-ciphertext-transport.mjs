#!/usr/bin/env node
// RAP-16: transport opaque age ciphertext to a dedicated Drive folder.
// Does NOT connect to PostgreSQL, decrypt, delete, or inspect personal data.
// A successful transfer is integrity evidence, NEVER proof of a full restore.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,lstatSync,openSync,readSync,closeSync,existsSync,realpathSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {dirname,isAbsolute,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ID=/^[A-Za-z0-9_-]{5,150}$/;
const NAME=/^TUTOR_V58_PG17_[0-9]{8}_[0-9]{5,20}_[0-9]{1,5}\.age$/;
const MAX_BYTES=512*1024*1024;
const header=Buffer.from('age-encryption.org/v1\n');
function assertPrivate(p,description){
  assert.ok(isAbsolute(p),description+' must use absolute path');
  const stat=lstatSync(p);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink(),description+' must be a regular file');
  assert.equal(stat.mode&0o077,0,description+' must be owner-only');
  return stat;
}
function assertPrivateParent(p){
  const d=realpathSync(dirname(p)),s=lstatSync(d);
  assert.ok(s.isDirectory() && (s.mode&0o077)===0,'Download parent must be owner-only');
}
async function hashFile(p){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(p))hash.update(chunk);
  return hash.digest('hex');
}
function assertAgeFile(p){
  const stat=assertPrivate(p,'Age ciphertext');
  assert.ok(stat.size>64&&stat.size<=MAX_BYTES,'Encrypted archive size invalid');
  const fd=openSync(p,'r');
  try{
    const actual=Buffer.alloc(header.length);
    assert.equal(readSync(fd,actual,0,actual.length,0),header.length);
    assert.ok(actual.equals(header),'Only binary age v1 ciphertext is accepted');
  }finally{closeSync(fd);}
  return stat.size;
}
function assertUrl(location){
  const u=new URL(location);
  assert.ok(u.protocol==='https:'&&u.hostname==='www.googleapis.com'&&
    u.pathname==='/upload/drive/v3/files','Unsafe Drive upload session URL');
  return u.toString();
}
export async function uploadAndVerifyCiphertext({
  inputPath,downloadPath,folderId,name,oauth,request=fetch
}){
  assert.match(folderId||'',ID);
  assert.match(name||'',NAME);
  assert.ok(downloadPath&&isAbsolute(downloadPath),'Absolute download path required');
  assert.ok(!existsSync(downloadPath),'Refuse overwriting downloaded ciphertext');
  assertPrivateParent(downloadPath);
  const sourceReal=realpathSync(inputPath);
  const downloadReal=resolve(downloadPath);
  assert.notEqual(sourceReal,downloadReal,'Input and output must differ');
  const bytes=assertAgeFile(inputPath);
  for(const key of ['clientId','clientSecret','refreshToken']){
    assert.ok(typeof oauth?.[key]==='string'&&oauth[key].length>5,'OAuth config incomplete');
  }
  const expected=await hashFile(inputPath);
  const form=new URLSearchParams({client_id:oauth.clientId,client_secret:oauth.clientSecret,
    refresh_token:oauth.refreshToken,grant_type:'refresh_token'});
  const token=await request('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:form.toString(),redirect:'error'
  });
  if(!token.ok)throw new Error('OAuth refresh failed');
  const payload=await token.json();
  assert.ok(typeof payload.access_token==='string'&&payload.access_token.length>10,
    'OAuth response invalid');
  const auth='Bearer '+payload.access_token;
  const session=await request(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id%2Cname%2Csize',{
      method:'POST',redirect:'error',
      headers:{Authorization:auth,'Content-Type':'application/json; charset=UTF-8',
        'X-Upload-Content-Type':'application/octet-stream',
        'X-Upload-Content-Length':String(bytes)},
      body:JSON.stringify({name,parents:[folderId],mimeType:'application/octet-stream',
        appProperties:{kind:'v58_production_age_ciphertext',
          origin:'manual_approved_once',delete_allowed:'false'}})
    });
  if(!session.ok)throw new Error('Drive session failed');
  const loc=session.headers.get('location');
  assert.ok(loc,'Drive resumable upload URL missing');
  const uploaded=await request(assertUrl(loc),{
    method:'PUT',redirect:'error',
    headers:{Authorization:auth,'Content-Type':'application/octet-stream',
      'Content-Length':String(bytes)},
    body:createReadStream(inputPath),duplex:'half'
  });
  if(!uploaded.ok)throw new Error('Drive ciphertext upload failed');
  const created=await uploaded.json();
  assert.match(created.id||'',ID);
  const id=encodeURIComponent(created.id);
  const meta=await request('https://www.googleapis.com/drive/v3/files/'+id+
    '?fields=id%2Cname%2Cparents%2Csize',{
      headers:{Authorization:auth},redirect:'error'
    });
  if(!meta.ok)throw new Error('Drive metadata verification failed');
  const m=await meta.json();
  assert.equal(m.id,created.id,'Drive ID mismatch');
  assert.equal(m.name,name,'Drive name mismatch');
  assert.ok(Array.isArray(m.parents)&&m.parents.includes(folderId),'Wrong Drive folder');
  assert.equal(Number(m.size),bytes,'Drive uploaded size mismatch');
  const download=await request(
    'https://www.googleapis.com/drive/v3/files/'+id+'?alt=media',{
      headers:{Authorization:auth},redirect:'error'
    });
  if(!download.ok||!download.body)throw new Error('Drive readback failed');
  // The destination is a private, caller-owned ephemeral directory. Never overwrite.
  let received=0;
  const limit=new Transform({transform(chunk,_encoding,callback){
    received+=chunk.length;
    if(received>bytes || received>MAX_BYTES)callback(new Error('Drive readback exceeds declared size'));
    else callback(null,chunk);
  }});
  await pipeline(Readable.fromWeb(download.body),limit,
    createWriteStream(downloadPath,{flags:'wx',mode:0o600}));
  const actualBytes=assertAgeFile(downloadPath);
  if(actualBytes!==bytes||await hashFile(downloadPath)!==expected){
    throw new Error('Drive readback SHA-256 mismatch');
  }
  return {status:'CIPHERTEXT_DRIVE_ROUNDTRIP_PASS',drive_id:created.id,
    ciphertext_bytes:bytes,ciphertext_sha256:expected,
    production_backup_restore_verified:false,drive_mutations:['upload_only']};
}
function assertApprovedRunner(e,p){
  assert.equal(e.GITHUB_ACTIONS,'true');
  assert.equal(e.GITHUB_REPOSITORY,'zhichiangai/tutor-app');
  assert.equal(e.GITHUB_EVENT_NAME,'workflow_dispatch');
  assert.equal(e.GITHUB_REF,'refs/heads/main');
  assert.match(e.GITHUB_SHA||'',/^[a-f0-9]{40}$/);
  assert.equal(e.GITHUB_SHA,e.V58_REVIEWED_MAIN_SHA,'Release SHA has not been approved');
  assert.equal(e.V58_CLOUD_BACKUP_AUTHORIZATION,'ONE_TIME_PRODUCTION_READ_ONLY_BACKUP');
  assert.equal(e.V58_BACKUP_PROJECT_REF,'vctisuglfoxyuwlvyjee');
  assert.equal(e.V58_BACKUP_EXECUTION_MODE,'ENCRYPTED_DRIVE_ONCE');
  assert.ok(e.RUNNER_TEMP&&isAbsolute(e.RUNNER_TEMP));
  for(const file of [p.inputPath,p.downloadPath]){
    const dir=realpathSync(dirname(file));
    const rel=relative(realpathSync(e.RUNNER_TEMP),dir);
    assert.ok(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&
      !isAbsolute(rel)),'Backup paths must stay inside runner temp');
  }
  assert.ok(!e.SUPABASE_ACCESS_TOKEN&&!e.SUPABASE_DB_URL&&!e.DATABASE_URL,
    'Unapproved alternative database credentials');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assert.equal(process.argv.length,4,'Expected age file and downloaded file');
    const [inputPath,downloadPath]=process.argv.slice(2);
    assertApprovedRunner(process.env,{inputPath,downloadPath});
    const result=await uploadAndVerifyCiphertext({
      inputPath,downloadPath,folderId:process.env.V58_PRODUCTION_DRIVE_FOLDER_ID,
      name:process.env.V58_BACKUP_CIPHERTEXT_NAME,
      oauth:{clientId:process.env.GDRIVE_CLIENT_ID,
        clientSecret:process.env.GDRIVE_CLIENT_SECRET,
        refreshToken:process.env.GDRIVE_REFRESH_TOKEN}
    });
    // Never expose opaque Drive file IDs in public Actions logs.
    const {drive_id: _privateFileId,...publicStatus}=result;
    process.stdout.write(JSON.stringify({...publicStatus,drive_file_created:true})+'\n');
  }catch{
    process.stderr.write('NO_GO: protected age ciphertext Drive transport failed; no secrets emitted\n');
    process.exitCode=2;
  }
}
