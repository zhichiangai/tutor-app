#!/usr/bin/env bash
# CI-only, synthetic source -> destination across TWO disposable local
# Supabase stacks. No hosted project, no real passwords, no network outputs.
set -euo pipefail
set +x
umask 077
[[ "${CI:-}" == 'true' && "${V58_MANAGED_STATE_LOCAL:-}" == '1' ]] || {
  echo 'REFUSED: synthetic CI flag required' >&2; exit 2;
}
for secret in SUPABASE_ACCESS_TOKEN V58_PRIVATE_DB_URL PGPASSWORD PGHOST PGUSER PGSERVICE; do
  [[ -z "${!secret:-}" ]] || { echo 'REFUSED: unexpected external DB/Auth settings' >&2; exit 2; }
done
base="${RUNNER_TEMP:?}/v58-managed-state-transfer"
[[ "$base" == /home/runner/work/_temp/* ]] || {
  echo 'REFUSED: only isolated GitHub runner temp path allowed' >&2; exit 2;
}
[[ ! -e "$base" ]] || { echo 'REFUSED: temporary directory already exists' >&2; exit 2; }
mkdir -m 700 -p "$base/private" "$base/source/supabase" "$base/target/supabase"
src='tutor_v58_state_source'
dst='tutor_v58_state_target'
source_db="supabase_db_$src"
target_db="supabase_db_$dst"
cleanup(){
  for project in source target; do
    cfg="$base/$project/supabase/config.toml"
    if [[ -f "$cfg" ]] && grep -q "^project_id = \"tutor_v58_state_" "$cfg"; then
      (cd "$base/$project" && supabase stop --no-backup >/dev/null 2>&1) || true
    fi
  done
  rm -rf "$base"
}
trap cleanup EXIT

# Make unlinked, no-seed/no-repo-migrations, unique-port configurations.
python3 - "$base" <<'PY'
from pathlib import Path
import re,sys
root=Path(sys.argv[1])
raw=Path('supabase/config.toml').read_text()
assert raw.count('project_id = "tutor_v4_isolated"')==1
for kind,project,offset in [('source','tutor_v58_state_source',2000),
                            ('target','tutor_v58_state_target',3000)]:
 s=raw.replace('project_id = "tutor_v4_isolated"',f'project_id = "{project}"')
 for section in ('db.migrations','db.seed'):
  pat=r'(?m)(^\['+re.escape(section)+r'\]\n(?:#[^\n]*\n)*enabled = )true'
  s,n=re.subn(pat,r'\1false',s,count=1)
  assert n==1,(project,section)
 for old in (54320,54321,54322,54323,54324,54329):
  # CI fixture has no external service ports or production settings.
  s=s.replace('port = '+str(old),'port = '+str(old+offset))
 p=root/kind/'supabase'/'config.toml'
 p.write_text(s)
PY

start_stack(){
  local kind="$1" name="$2"
  local logfile="$base/private/$kind-start.log"
  local folder="$base/$kind"
  test ! -f "$folder/supabase/.temp/project-ref"
  test ! -f "$folder/supabase/.branches/_current_branch"
  grep -Fqx "project_id = \"$name\"" "$folder/supabase/config.toml"
  if ! (cd "$folder" && supabase start -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >"$logfile" 2>&1); then
    echo "FAIL: $kind disposable Supabase failed startup; raw output suppressed" >&2
    exit 1
  fi
  (cd "$folder" && supabase status -o env) > "$base/private/$kind.env"
  chmod 600 "$base/private/$kind.env"
  echo "PASS: synthetic $kind Supabase Auth and Storage stack started"
}
stop_stack(){
 local folder="$base/$1"
 (cd "$folder" && supabase stop --no-backup >/dev/null 2>&1)
 echo "PASS: synthetic $1 stack stopped; archive remains outside Docker"
}
dbscalar(){
 docker exec "$1" psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "$2"
}

start_stack source "$src"
docker inspect "$source_db" >/dev/null
test "$(docker inspect -f '{{.State.Running}}' "$source_db")" = true
node tests/local/v58-managed-state-transfer.mjs source "$base/private/source.env" "$base/private"

# Create exactly 62 fake migration history rows in the disposable local source.
docker exec -i "$source_db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
 version text PRIMARY KEY, name text
);
INSERT INTO supabase_migrations.schema_migrations(version,name)
SELECT '20261001'||lpad(i::text,6,'0'), 'synthetic_fixture_'||i
FROM generate_series(1,62) AS i;
SQL

source_counts="$(dbscalar "$source_db" "SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM auth.identities),(SELECT count(*) FROM auth.sessions),(SELECT count(*) FROM auth.refresh_tokens),(SELECT count(*) FROM storage.buckets),(SELECT count(*) FROM storage.objects),(SELECT count(*) FROM supabase_migrations.schema_migrations)")"
IFS='|' read -r users identities sessions tokens buckets objects migrations <<<"$source_counts"
test "$users" -eq 1
test "$identities" -ge 1
test "$sessions" -ge 1
test "$tokens" -ge 1
test "$buckets" -eq 1
test "$objects" -eq 1
test "$migrations" -eq 62
echo 'PASS: source local Auth user/identity/session/refresh token, Storage metadata and 62 synthetic migrations'

# Exact selected managed DATA tables; no platform Schema/Role/DDL restoration.
docker exec "$source_db" pg_dump -U postgres -d postgres --format=custom  --data-only --no-owner --no-acl  --table=auth.users --table=auth.identities --table=auth.sessions  --table=auth.refresh_tokens --table=supabase_migrations.schema_migrations  --file=/tmp/v58-synthetic-managed.dump
docker cp "$source_db:/tmp/v58-synthetic-managed.dump" "$base/private/managed.dump" >/dev/null
chmod 600 "$base/private/managed.dump"
docker exec "$source_db" pg_restore --list /tmp/v58-synthetic-managed.dump   > "$base/private/source.toc"
chmod 600 "$base/private/source.toc"
node tests/local/v58-managed-state-data-list.mjs "$base/private/source.toc"   "$base/private/managed.list"
stop_stack source

start_stack target "$dst"
docker inspect "$target_db" >/dev/null
test "$(docker inspect -f '{{.State.Running}}' "$target_db")" = true
# Target migration history must have a compatible empty table.
docker exec -i "$target_db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
 version text PRIMARY KEY, name text
);
SQL
before="$(dbscalar "$target_db" "SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM auth.identities),(SELECT count(*) FROM auth.sessions),(SELECT count(*) FROM auth.refresh_tokens),(SELECT count(*) FROM storage.buckets),(SELECT count(*) FROM storage.objects),(SELECT count(*) FROM supabase_migrations.schema_migrations)")"
test "$before" = '0|0|0|0|0|0|0' || {
  echo 'FAIL: managed target is not clean: refusing import' >&2; exit 1;
}
docker cp "$base/private/managed.dump" "$target_db:/tmp/v58-synthetic-managed.dump" >/dev/null
docker cp "$base/private/managed.list" "$target_db:/tmp/v58-synthetic-managed.list" >/dev/null
docker exec "$target_db" pg_restore -U postgres -d postgres --data-only   --use-list=/tmp/v58-synthetic-managed.list --no-owner --no-acl   --single-transaction --exit-on-error /tmp/v58-synthetic-managed.dump >/dev/null
imported="$(dbscalar "$target_db" "SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM auth.identities),(SELECT count(*) FROM auth.sessions),(SELECT count(*) FROM auth.refresh_tokens),(SELECT count(*) FROM supabase_migrations.schema_migrations)")"
IFS='|' read -r users identities sessions tokens migrations <<<"$imported"
test "$users" -eq 1
test "$identities" -ge 1
test "$sessions" -ge 1
test "$tokens" -ge 1
test "$migrations" -eq 62
echo 'PASS: target local Auth identities, sessions, refresh-token metadata and 62 synthetic migration rows transferred'
# pg_dump --table scoped TABLE DATA doesn't reliably carry sequence state.
# A newly created GoTrue session can otherwise collide with imported
# auth.refresh_tokens.id. This is a disposable local target ONLY.
docker exec -i "$target_db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SELECT setval(
 pg_get_serial_sequence('auth.refresh_tokens','id')::regclass,
 GREATEST((SELECT COALESCE(MAX(id),0) FROM auth.refresh_tokens),1),
 true
);
SQL
echo 'PASS: local target Auth refresh token sequence reconciled before new login'

# Storage bytes MUST travel through Storage API; copying storage.objects
# metadata without object bytes would create a broken restore.
node tests/local/v58-managed-state-transfer.mjs target "$base/private/target.env" "$base/private"
storage="$(dbscalar "$target_db" "SELECT (SELECT count(*) FROM storage.buckets),(SELECT count(*) FROM storage.objects)")"
test "$storage" = '1|1'
echo 'PASS: Storage API target metadata and byte-for-byte object parity'
echo 'PARTIAL: authenticated session validity across changed signing keys, OAuth provider setup and complete Production rollback still unverified'
echo 'NOT TESTED: any real Production backup, paid resource or migration'
