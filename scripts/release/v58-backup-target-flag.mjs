#!/usr/bin/env node
// Pure version/flag selector. Reads CLI help only; no network, credentials,
// production database, or SQL data. Rejects unreviewed major versions.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function selectDumpTargetFlag(version,help){
 if(typeof version!=='string'||typeof help!=='string') throw Error('CLI version/help required');
 const semver=/^([0-9]+)\.[0-9]+\.[0-9]+(?:[+-][A-Za-z0-9.-]+)?$/.exec(version.trim());
 if(!semver) throw Error('Invalid Supabase CLI version');
 if(semver[1]==='2'){
  if(!help.includes('--db-url')) throw Error('CLI v2 missing --db-url');
  return '--db-url';
 }
 if(semver[1]==='3'){
  if(!help.includes('--remote')) throw Error('CLI v3 missing --remote');
  return '--remote';
 }
 throw Error('Unsupported Supabase CLI major: only v2 and v3 reviewed');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const version=process.argv[2];
  if(process.argv.length!==3)throw Error('Exactly one CLI version argument required');
  const help=readFileSync(0,'utf8');
  process.stdout.write(selectDumpTargetFlag(version,help)+'\n');
 }catch{
  // Do not echo the CLI help or a database connection string in errors.
  process.stderr.write('REFUSED: unsupported or incompatible Supabase CLI dump target\n');
  process.exitCode=2;
 }
}
