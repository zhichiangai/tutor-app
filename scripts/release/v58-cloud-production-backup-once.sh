#!/usr/bin/env bash
# RAP-16: Candidate ONE-TIME Production read-only cloud backup.
# Only after reviewed main SHA + protected Environment approval. No schedule.
set -Eeuo pipefail
set +x
umask 077
no_go(){ echo 'NO_GO: protected cloud backup stopped; no Production write requested' >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
node "$repo/scripts/release/v58-cloud-production-gate.mjs" || no_go
[[ -n "${RUNNER_TEMP:-}" && -n "${V58_RUN_PRIVATE_DIR:-}" ]] || no_go
[[ "$V58_RUN_PRIVATE_DIR" == "$RUNNER_TEMP"/v58-prod-"${GITHUB_RUN_ID}"-"${GITHUB_RUN_ATTEMPT}" ]] || no_go
[[ -d "$V58_RUN_PRIVATE_DIR" ]] || no_go
[[ "$(stat -c '%a' "$V58_RUN_PRIVATE_DIR")" == '700' ]] || no_go
cleanup(){
  if [[ -n "${V58_RUN_PRIVATE_DIR:-}" &&
    "$V58_RUN_PRIVATE_DIR" == "$RUNNER_TEMP"/v58-prod-"${GITHUB_RUN_ID}"-"${GITHUB_RUN_ATTEMPT}" ]]; then
    rm -rf -- "$V58_RUN_PRIVATE_DIR"
  fi
}
trap cleanup EXIT
for tool in pg_dump pg_dumpall pg_restore node age tar sha256sum; do
  command -v "$tool" >/dev/null || no_go
done
for tool in pg_dump pg_dumpall pg_restore; do
  [[ "$("$tool" --version)" =~ 17\.[0-9]+ ]] || no_go
done
[[ -z "${PGPASSWORD:-}" && -z "${SUPABASE_DB_URL:-}" && -z "${DATABASE_URL:-}" ]] || no_go
export V58_PRIVATE_BACKUP_DIR="$V58_RUN_PRIVATE_DIR/archived"
node "$repo/scripts/release/v58-pg17-credential-guard.mjs" || no_go
mkdir -m 700 "$V58_PRIVATE_BACKUP_DIR"
log="$V58_RUN_PRIVATE_DIR/private.log"
: > "$log"; chmod 600 "$log"
# Globals are a separate metadata snapshot; not atomic with pg_dump.
pg_dumpall --globals-only --no-role-passwords --no-password \
  --file="$V58_PRIVATE_BACKUP_DIR/roles.sql" >>"$log" 2>&1 || no_go
chmod 600 "$V58_PRIVATE_BACKUP_DIR/roles.sql"
# One custom-format MVCC snapshot for all accessible schemas.
pg_dump --format=custom --no-password --lock-wait-timeout=15s \
  --file="$V58_PRIVATE_BACKUP_DIR/production.snapshot.dump" >>"$log" 2>&1 || no_go
chmod 600 "$V58_PRIVATE_BACKUP_DIR/production.snapshot.dump"
pg_restore --list "$V58_PRIVATE_BACKUP_DIR/production.snapshot.dump" \
  > "$V58_PRIVATE_BACKUP_DIR/private-toc.txt" 2>>"$log" || no_go
chmod 600 "$V58_PRIVATE_BACKUP_DIR/private-toc.txt"
grep -Eq '[[:space:]](TABLE|TABLE DATA) public ' "$V58_PRIVATE_BACKUP_DIR/private-toc.txt" || no_go
for required in tutor_private auth storage supabase_migrations; do
  grep -Eq "[[:space:]]SCHEMA - $required([[:space:]]|$)" \
    "$V58_PRIVATE_BACKUP_DIR/private-toc.txt" || no_go
done
( cd "$V58_PRIVATE_BACKUP_DIR"; sha256sum roles.sql production.snapshot.dump > private-checksums.sha256 )
chmod 600 "$V58_PRIVATE_BACKUP_DIR/private-checksums.sha256"
tar -C "$V58_PRIVATE_BACKUP_DIR" --format=posix \
  -cf "$V58_RUN_PRIVATE_DIR/plain-archive.tar" \
  roles.sql production.snapshot.dump private-toc.txt private-checksums.sha256 \
  >>"$log" 2>&1 || no_go
chmod 600 "$V58_RUN_PRIVATE_DIR/plain-archive.tar"
age -r "$V58_AGE_RECIPIENT" -o "$V58_RUN_PRIVATE_DIR/backup.age" \
  "$V58_RUN_PRIVATE_DIR/plain-archive.tar" >>"$log" 2>&1 || no_go
chmod 600 "$V58_RUN_PRIVATE_DIR/backup.age"
# Remove all raw files before the first Drive API call.
rm -f -- "$V58_RUN_PRIVATE_DIR/plain-archive.tar"
rm -rf -- "$V58_PRIVATE_BACKUP_DIR"
rm -f -- "$log"
date_part="$(date -u '+%Y%m%d')"
export V58_BACKUP_CIPHERTEXT_NAME="TUTOR_V58_PG17_${date_part}_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}.age"
node "$repo/scripts/release/v58-gdrive-ciphertext-transport.mjs" \
  "$V58_RUN_PRIVATE_DIR/backup.age" "$V58_RUN_PRIVATE_DIR/returned.age" || no_go
echo 'CIPHERTEXT_TRANSPORT_PASS; FULL_SUPABASE_RESTORE_NOT_TESTED'
echo 'Migration 63/64 and Main/Production release authorization NOT INCLUDED'
