#!/usr/bin/env node
// SOURCE-ONLY pg_restore --list (TOC) inspector.
// Produces an APP-ONLY proposal for a disposable, initialized Supabase target.
// NEVER connects to a database, executes SQL, selects managed auth/storage
// objects, or considers an app-only restore a complete Supabase restore.
import {readFileSync,writeFileSync,lstatSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const APP=new Set(['public','tutor_private']);
const MANAGED=new Set(['auth','storage','supabase_migrations','realtime',
 '_realtime','graphql','graphql_public','vault','extensions',
 'pgsodium','net','pg_catalog','information_schema']);
const ALLOWED_TYPES=new Set([
 'SCHEMA','TABLE','TABLE DATA','SEQUENCE','SEQUENCE OWNED BY',
 'SEQUENCE SET','VIEW','MATERIALIZED VIEW','MATERIALIZED VIEW DATA',
 'FUNCTION','PROCEDURE','TYPE','DOMAIN','CONSTRAINT','FK CONSTRAINT',
 'INDEX','INDEX ATTACH','TRIGGER','POLICY','ROW SECURITY','RULE',
 'DEFAULT','STATISTICS','COMMENT'
]);
const DESCRIPTORS=[
 'MATERIALIZED VIEW DATA','MATERIALIZED VIEW','SEQUENCE OWNED BY',
 'FK CONSTRAINT','DEFAULT ACL','SEQUENCE SET','TABLE DATA',
 'ROW SECURITY','INDEX ATTACH','EVENT TRIGGER','INDEX','TABLE',
 'SEQUENCE','FUNCTION','PROCEDURE','TRIGGER','POLICY','VIEW',
 'CONSTRAINT','SCHEMA','EXTENSION','COMMENT','ACL','RULE','TYPE',
 'DOMAIN','DEFAULT','STATISTICS','PUBLICATION','SUBSCRIPTION',
 'CAST','DATABASE','COLLATION','TEXT SEARCH CONFIGURATION'
].sort((a,b)=>b.length-a.length);

export function buildManagedAppRestorePlan(toc) {
 if(typeof toc!=='string'||toc.length===0)throw Error('Missing source TOC');
 const app=[],held=[],unknown=[],counts={};
 let seenPublicTable=false,seenPrivate=false,seenManaged=false,seenExtension=false;
 let entries=0;
 for(const line of toc.split(/\r?\n/)) {
  if(!line.trim()||line.startsWith(';'))continue;
  const m=/^\d+;\s+\d+\s+\d+\s+(.+)$/.exec(line);
  if(!m){unknown.push('unrecognized_toc_line');continue;}
  entries++;
  const tail=m[1];
  const type=DESCRIPTORS.find(t=>tail.startsWith(t+' '));
  if(!type){unknown.push('unrecognized_descriptor');continue;}
  const rest=tail.slice(type.length+1).trim();
  const [schema,object]=rest.split(/\s+/,2);
  if(MANAGED.has(schema))seenManaged=true;
  if(type==='EXTENSION')seenExtension=true;
  if(type==='SCHEMA'){
   const name=object;
   if(name==='tutor_private'){app.push(line);seenPrivate=true;}
   else if(name==='public'||MANAGED.has(name)){if(MANAGED.has(name))seenManaged=true;held.push(type);}
   else unknown.push('unreviewed_schema');
   continue;
  }
  // For pg_restore entries like EXTENSION - pgcrypto, COMMENT - ...
  // or ACL with special role targets, leave out of the app-only subset.
  if(schema==='-'||type==='ACL'||type==='DEFAULT ACL'||
     type==='EXTENSION'||type==='EVENT TRIGGER'||
     type==='PUBLICATION'||type==='SUBSCRIPTION'){
   held.push(type);continue;
  }
  if(APP.has(schema)){
   if(!ALLOWED_TYPES.has(type)){unknown.push('unreviewed_app_object_type');continue;}
   if(type==='TABLE'&&schema==='public')seenPublicTable=true;
   app.push(line);
   counts[type]=(counts[type]??0)+1;
  }else if(MANAGED.has(schema)){
   held.push(type);
  }else {
   unknown.push('unreviewed_schema_or_object_type');
  }
 }
 if(entries===0)unknown.push('empty_toc');
 if(!seenPublicTable)unknown.push('missing_public_table');
 if(!seenPrivate)unknown.push('missing_tutor_private_schema');
 if(!seenManaged)unknown.push('missing_managed_schema_entries');
 // Not every database has a non-default extension; record but do not require one.
 return {
  status:unknown.length?'BLOCKED_UNREVIEWED_TOC':'APP_ONLY_RESTORE_PROPOSAL_NOT_EXECUTABLE',
  selected_count:app.length,held_count:held.length,
  reviewed_entries:entries,has_unreviewed:unknown.length>0,
  // Generic categories only. No SQL, private table names or auth rows printed.
  unreviewed_categories:[...new Set(unknown)].sort(),
  selected_type_counts:counts,
  toc:unknown.length?null:toc.split(/\r?\n/).filter(x=>!x.trim()||x.startsWith(';')||app.includes(x)).join('\n')+'\n',
  managed_auth_storage_data_restored:false,
  role_sql_restored:false,extension_reconciled:false,
  production_writes:0,full_supabase_restore_verified:false
 };
}

function privateFile(path,kind){
 if(!path||!isAbsolute(path))throw Error(kind+' must be an absolute path');
 const p=resolve(path),real=realpathSync(kind==='input'?p:dirname(p));
 const rel=relative(repo,real);
 if(!(rel==='..'||rel.startsWith('..'+sep)))throw Error('Refuse Git tree');
 if(kind==='input'){
  const s=lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)
   throw Error('Input TOC must be private regular file');
 }else {
  if(existsSync(p))throw Error('Output exists; cannot overwrite');
  if((lstatSync(real).mode&0o077)!==0)throw Error('Output directory not private');
 }
 return p;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
  if(process.argv.length!==4)throw Error('Usage: source_TOC_abs output_TOC_abs');
  if(process.env.GITHUB_ACTIONS||process.env.CI)throw Error('Private TOC planner must not run in CI');
  const source=privateFile(process.argv[2],'input');
  const output=privateFile(process.argv[3],'output');
  const result=buildManagedAppRestorePlan(readFileSync(source,'utf8'));
  if(result.status!=='APP_ONLY_RESTORE_PROPOSAL_NOT_EXECUTABLE'){
   process.stderr.write('NO_GO: archive TOC requires manual classification\n');
   process.exitCode=2;
  }else{
   writeFileSync(output,result.toc,{flag:'wx',mode:0o600});
   // The output is only a proposed pg_restore -L list. It does not
   // authorize applying it to any DB. Keep it private like the archive.
   const {toc:ignored,...summary}=result;
   process.stdout.write(JSON.stringify(summary)+'\n');
  }
 }catch{
  process.stderr.write('NO_GO: private TOC validation failed\n');
  process.exitCode=2;
 }
}
