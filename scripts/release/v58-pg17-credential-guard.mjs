#!/usr/bin/env node
// Fail-closed private Production PostgreSQL 17 backup target validation.
// Does not read or print .pgpass contents, query databases, or spawn children.
import assert from 'node:assert/strict';
import {lstatSync,realpathSync,existsSync} from 'node:fs';
import {isAbsolute,resolve,relative,dirname,basename,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const ref='vctisuglfoxyuwlvyjee';
const assertOwnerOnly=(path,description)=>{
 const stat=lstatSync(path);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink(),description+' must be regular, not symlink');
 assert.equal(stat.mode&0o077,0,description+' must not be readable by group/others');
};
export function assertProductionTarget(e){
 for(const unsafe of ['PGPASSWORD','V58_PRIVATE_DB_URL','PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS']){
  assert.ok(!e[unsafe], 'Unsafe/ambiguous connection environment: '+unsafe);
 }
 assert.equal(e.PGPORT,'5432');
 assert.equal(e.PGDATABASE,'postgres');
 assert.ok(['require','verify-ca','verify-full'].includes(e.PGSSLMODE),'TLS required');
 const direct=e.PGHOST==='db.'+ref+'.supabase.co' && e.PGUSER==='postgres';
 const session=/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(e.PGHOST||'') &&
    e.PGUSER==='postgres.'+ref;
 assert.ok(direct||session,'Wrong database target or user: refusing');
 assert.ok(e.PGPASSFILE&&isAbsolute(e.PGPASSFILE),'Absolute PGPASSFILE required');
 assertOwnerOnly(e.PGPASSFILE,'PGPASSFILE');
 const pass=realpathSync(e.PGPASSFILE);
 const passRel=relative(repo,pass);
 assert.ok(passRel==='..'||passRel.startsWith('..'+sep),
  'Password file must be outside Git repository');
 const target=e.V58_PRIVATE_BACKUP_DIR;
 assert.ok(target&&isAbsolute(target),'Absolute private backup directory required');
 assert.ok(!existsSync(target),'Refuse an existing or reusable backup directory');
 const parent=realpathSync(dirname(target));
 const stat=lstatSync(parent);
 assert.ok(stat.isDirectory(),'Backup parent must be a directory');
 assert.equal(stat.mode&0o077,0,'Backup parent must be owner-only');
 const output=join(parent,basename(target));
 const rel=relative(repo,output);
 assert.ok(rel==='..'||rel.startsWith('..'+sep),'Backup must be outside Git repository');
 assert.ok(output!==pass,'Backup must not overwrite credentials');
 return {status:'PASS',target_project:ref,mode:direct?'direct':'session_pooler',
  credentials_printed:0,production_writes:0};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try {
  assert.equal(process.argv.length,2);
  const r=assertProductionTarget(process.env);
  process.stdout.write(JSON.stringify(r)+'\n');
 }catch {
  process.stderr.write('REFUSED: private Production target, credential, or directory gate failed\n');
  process.exitCode=2;
 }
}
