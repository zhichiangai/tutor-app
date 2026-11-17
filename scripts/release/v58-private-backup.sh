#!/usr/bin/env bash
# Production READ ONLY. No credentials in argv, logs, shell history or code.
# Pg17 client uses libpq PGPASSFILE (0600) instead of URL/password flags.
# One pg_dump custom archive = one database MVCC snapshot across all schemas.
# Roles are separately exported global catalog: NOT the same MVCC snapshot.
set -euo pipefail
set +x
umask 077

if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
  echo 'REFUSED: CI environments are not private backup destinations' >&2
  exit 2
fi
command -v node >/dev/null || { echo 'REFUSED: Node 22+ required' >&2; exit 2; }
for cmd in pg_dump pg_dumpall pg_restore; do
  command -v "$cmd" >/dev/null || { echo "REFUSED: Missing PostgreSQL client $cmd" >&2; exit 2; }
  version="$("$cmd" --version)"
  if [[ ! "$version" =~ 17\.[0-9]+ ]]; then
    echo "REFUSED: PostgreSQL 17 client required for $cmd" >&2
    exit 2
  fi
done
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
node "$root/scripts/release/v58-pg17-credential-guard.mjs"
out="$V58_PRIVATE_BACKUP_DIR"
mkdir -m 700 "$out"
chmod 700 "$out"
# No pgpass output, credentials and URLs must never enter commands.
printf '%s\n' 'INCOMPLETE: BACKUP_AND_RESTORE_NO_GO' > "$out/STATUS.txt"
log="$out/operator-private.log"
: > "$log"
chmod 600 "$log"
export V58_BACKUP_STARTED_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
export V58_PGDUMP_VERSION="$(pg_dump --version)"
echo 'Exporting global roles metadata (password hashes intentionally excluded)'
if ! pg_dumpall --globals-only --no-role-passwords --no-password \
  --file="$out/roles.sql" >>"$log" 2>&1; then
  echo 'FAIL: Role export incomplete; archive is unusable for release' >&2
  exit 2
fi
chmod 600 "$out/roles.sql"

echo 'Exporting ONE consistent snapshot of all dumpable non-system schemas'
if ! pg_dump --format=custom --no-password --lock-wait-timeout=15s \
  --file="$out/production.snapshot.dump" >>"$log" 2>&1; then
  echo 'FAIL: Database archive incomplete; do not release' >&2
  exit 2
fi
chmod 600 "$out/production.snapshot.dump"
if ! pg_restore --list "$out/production.snapshot.dump" > "$out/private-toc.txt" 2>>"$log"; then
  echo 'FAIL: pg_restore could not inspect archive; do not release' >&2
  exit 2
fi
chmod 600 "$out/private-toc.txt"
# Fail closed if core managed/custom schemas were not archived.
# The built-in "public" schema may be omitted from archive DDL.
# Its production TABLE entries are sufficient proof of public data inclusion.
if ! grep -Eq '[[:space:]](TABLE|TABLE DATA) public ' "$out/private-toc.txt"; then
  echo 'FAIL: public tables absent from custom archive' >&2
  exit 2
fi
for schema in tutor_private auth storage supabase_migrations; do
  if ! grep -Eq "[[:space:]]SCHEMA - $schema([[:space:]]|$)" "$out/private-toc.txt"; then
    echo "FAIL: required custom/managed schema missing from archive: $schema" >&2
    exit 2
  fi
done
export V58_BACKUP_FINISHED_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
node "$root/scripts/release/v58-private-backup-manifest.mjs" create "$out"
printf '%s\n' 'ARCHIVE_INTEGRITY_PASS_RESTORE_NOT_TESTED' > "$out/STATUS.txt"
chmod 600 "$out/STATUS.txt"
echo 'PASS: private one-snapshot archive, roles and checksums produced; RESTORE NOT TESTED'
echo 'Do not publish the files; all real SQL remains in the encrypted private backup directory'
