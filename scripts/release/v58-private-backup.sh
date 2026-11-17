#!/usr/bin/env bash
# Owner-run in a PRIVATE workstation only. NEVER run in GitHub Actions.
# Reads Production only via Supabase CLI pg_dump; writes sensitive SQL only outside git.
set -euo pipefail
umask 077
if [[ -n "${GITHUB_ACTIONS:-}" || -n "${CI:-}" ]]; then
  echo "REFUSED: CI environments are not private backup destinations" >&2
  exit 2
fi
: "${V58_PRIVATE_BACKUP_DIR:?Set a NEW absolute, private backup directory}"
: "${V58_PRIVATE_DB_URL:?Set the Production DB URL in this private shell only; never paste it in ChatGPT}"
command -v supabase >/dev/null || { echo "Missing Supabase CLI" >&2; exit 2; }
command -v node >/dev/null || { echo "Missing Node 22+" >&2; exit 2; }
node --input-type=module - <<'NODE'
import {realpathSync,existsSync} from 'node:fs';
import {resolve,relative,sep,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const project='vctisuglfoxyuwlvyjee',path=process.env.V58_PRIVATE_BACKUP_DIR;
if(!path||!isAbsolute(path)) throw Error('Absolute private output directory required');
if(existsSync(path)) throw Error('Output exists: do not reuse or overwrite backups');
const target=resolve(path),root=realpathSync(fileURLToPath(new URL('./',import.meta.url)));
const d=relative(process.cwd(),target);
if(!d.startsWith('..'+sep)&&d!=='..') throw Error('Never write backup inside the working tree');
if(!existsSync(dirname(target))) throw Error('Create private parent directory first');
let u;try{u=new URL(process.env.V58_PRIVATE_DB_URL||'');}
catch{throw Error('Invalid private DB connection URL');}
const user=decodeURIComponent(u.username);
const direct=u.hostname==='db.'+project+'.supabase.co'&&user==='postgres';
const pooled=u.hostname.endsWith('.pooler.supabase.com')&&user==='postgres.'+project;
if(!['postgres:','postgresql:'].includes(u.protocol)||!(direct||pooled)||
 (u.port&&u.port!=='5432')||u.pathname!=='/postgres'||!u.password||
 !['require','verify-ca','verify-full'].includes(u.searchParams.get('sslmode')))
 throw Error('FAIL: TLS/project/port/database/credential identity mismatch');
console.log('PASS: private-only backup target verified; credentials not printed');
NODE
mkdir -m 700 "$V58_PRIVATE_BACKUP_DIR"
log="$V58_PRIVATE_BACKUP_DIR/local-private.log"
touch "$log"
chmod 600 "$log"
printf '%s\n' "INCOMPLETE: do not release until private restore validation" > "$V58_PRIVATE_BACKUP_DIR/STATUS.txt"
help="$(supabase db dump --help 2>&1)"
if grep -q -- '--remote' <<<"$help"; then
  conn=("--remote=$V58_PRIVATE_DB_URL")
elif grep -q -- '--db-url' <<<"$help"; then
  conn=("--db-url=$V58_PRIVATE_DB_URL")
else
  echo "Unsupported CLI: db dump lacks --remote and --db-url" >&2
  exit 2
fi
dump(){
 local name="$1"; shift
 echo "Exporting private $name (no SQL contents logged)"
 if ! supabase db dump "${conn[@]}" -f "$V58_PRIVATE_BACKUP_DIR/$name" "$@" >>"$log" 2>&1; then
   echo "FAILED: $name; private log retained. Do not publish or release." >&2
   exit 2
 fi
 chmod 600 "$V58_PRIVATE_BACKUP_DIR/$name"
}
dump roles.sql --role-only
dump schema.sql
dump data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
dump auth_data.sql --use-copy --data-only --schema auth
dump storage_data.sql --use-copy --data-only --schema storage -x storage.buckets_vectors -x storage.vector_indexes
dump history_schema.sql --schema supabase_migrations
dump history_data.sql --use-copy --data-only --schema supabase_migrations
node scripts/release/v58-private-backup-manifest.mjs create "$V58_PRIVATE_BACKUP_DIR"
echo "Backup files and SHA-256 manifest created. Restore NOT tested; NO-GO for Production release."
echo "Keep the directory private and encrypted. Unset V58_PRIVATE_DB_URL in this shell."
