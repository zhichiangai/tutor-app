#!/usr/bin/env bash
# SYNTHETIC-ONLY selected-schema PostgreSQL pg_dump/pg_restore rehearsal.
# NEVER use this script with a hosted Production URL or production credentials.
set -euo pipefail
trap 'echo "::error::Synthetic restore setup/operation failed at line $LINENO (disposable CI only)"' ERR
[[ "${CI:-}" == "true" && "${GITHUB_ACTIONS:-}" == "true" ]] || { echo "::error::Not in GitHub CI"; exit 1; }
[[ "${V4_E2E_LOCAL:-}" == "1" ]] || { echo "::error::Not in isolated Supabase mode"; exit 1; }
grep -q '^project_id = "tutor_v4_isolated"$' supabase/config.toml ||
 { echo "::error::Unexpected Supabase project identifier"; exit 1; }
[[ ! -f supabase/.temp/project-ref ]] ||
 { echo "::error::Linked Supabase project detected; refuse backup"; exit 1; }
# Local CLI may create a .branches marker. Refuse hosted project-ref and use
# only the explicitly named disposable Docker database.
[[ -n "${RUNNER_TEMP:-}" ]] || { echo "::error::Runner temporary directory missing"; exit 1; }
umask 077
echo "Disposable-only restore guard PASS"

container="supabase_db_tutor_v4_isolated"
restored_db="tutor_v5_synthetic_restore"
backup="${RUNNER_TEMP}/v5_synthetic_full_db.dump"
restore_list="${RUNNER_TEMP}/v5_synthetic_restore.list"
restore_list_filtered="${RUNNER_TEMP}/v5_synthetic_restore.filtered.list"
# The only permitted operations are Docker's disposable CI PostgreSQL container.
docker inspect "$container" --format '{{.State.Running}}' | grep -qx true
cleanup() {
  rm -f "$backup" "$restore_list" "$restore_list_filtered" \
    "$RUNNER_TEMP"/v5_synthetic_schema_*.sql
  docker exec "$container" rm -f /tmp/v5_synthetic_restore.filtered.list >/dev/null 2>&1 || true
  docker exec "$container" dropdb -U postgres --if-exists "$restored_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

count_query="SELECT jsonb_build_object(
 'migration_history',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'users',(SELECT count(*) FROM auth.users),
 'workspaces',(SELECT count(*) FROM public.workspaces),
 'students',(SELECT count(*) FROM public.students),
 'lessons',(SELECT count(*) FROM public.lesson_records),
 'payment_batches',(SELECT count(*) FROM public.payment_batches),
 'v5_team_credits',(SELECT count(*) FROM tutor_private.v5_team_advance_credits),
 'v5_team_offsets',(SELECT count(*) FROM tutor_private.v5_team_advance_applications)
)::text"
before="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$count_query")"
test -n "$before"

# A schema-only dump includes table definitions, RLS policies and functions.
# Object-level ACLs are fingerprinted separately; pg_dump's platform default
# ACLs cannot be replayed under Supabase's restricted CI roles.
schema_fingerprints() {
  local db="$1" phase="$2" schema file hash
  for schema in public tutor_private auth supabase_migrations extensions; do
    file="${RUNNER_TEMP}/v5_synthetic_schema_${phase}_${schema}.sql"
    docker exec "$container" pg_dump --schema-only --no-owner --no-privileges \
      --schema="$schema" -U postgres -d "$db" > "$file"
    # PostgreSQL 17 adds a random psql \restrict token to each text dump.
    # Ignore dump comments and per-dump guard tokens before hashing.
    # CHECK expression pretty-printing may gain or lose redundant parentheses
    # across pg_dump/pg_restore. Compare those expressions using PostgreSQL's
    # parsed constraint tree below, while retaining all other DDL text here.
    hash="$(grep -v -E '^--|^\\(restrict|unrestrict) |^[[:space:]]*CONSTRAINT .* CHECK \(' "$file" |
      awk 'NF { sub(/[[:space:]]+$/, ""); print }' | sha256sum | cut -d' ' -f1)"
    printf '%s:%s\n' "$schema" "$hash"
  done
}
schema_before_hashes="$(schema_fingerprints postgres before)"
rows_before="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d postgres < tests/sql/v5_synthetic_row_fingerprint.sql)"
acl_before="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d postgres < tests/sql/v5_synthetic_acl_fingerprint.sql)"
checks_before="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d postgres < tests/sql/v5_synthetic_check_constraint_fingerprint.sql)"
app_acl_before="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d postgres < tests/sql/v5_synthetic_app_acl_fingerprint.sql)"
test -n "$schema_before_hashes"
test -n "$rows_before"
test -n "$acl_before"
test -n "$checks_before"
test -n "$app_acl_before"

# Keep the full synthetic dump in a private, short-lived runner file.
docker exec "$container" pg_dump --format=custom --no-owner \
  --schema=public --schema=tutor_private --schema=auth \
  --schema=supabase_migrations --schema=extensions \
  -U postgres -d postgres > "$backup"
test -s "$backup"
docker exec -i "$container" pg_restore --list < "$backup" > "$restore_list"
# Exclude only platform-managed DEFAULT ACL TOC entries and the single
# bootstrap "public" schema creation. PostgreSQL >=15 automatically creates
# public owned by pg_database_owner on every new database; dropping and
# recreating it as postgres silently breaks its ownership/ACL contract.
# Retain all TABLE/FUNCTION/POLICY/ACL entries in the public schema.
grep -Eq '^[0-9]+; .*SCHEMA - public( |$)' "$restore_list" || {
  echo "::error::Archive does not contain the expected built-in public schema TOC entry"
  exit 1
}
sed -E \
  -e '/^[0-9]+; .*DEFAULT ACL /s/^/; /' \
  -e '/^[0-9]+; .*SCHEMA - public( |$)/s/^/; /' \
  "$restore_list" > "$restore_list_filtered"
docker exec -i "$container" sh -c 'cat > /tmp/v5_synthetic_restore.filtered.list' \
  < "$restore_list_filtered"
docker exec "$container" createdb -U postgres "$restored_db"
# Preserve the PostgreSQL-native public schema and its pg_database_owner role.
# The archive TOC omits only CREATE SCHEMA public, not its ACL/objects.
native_public_owner="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" \
  -c "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public'")"
[[ "$native_public_owner" == "pg_database_owner" ]] || {
  echo "::error::Unexpected owner for freshly initialized PostgreSQL public schema"
  exit 1
}
# Restore into a distinct disposable database in the SAME LOCAL CI Postgres container.
docker exec -i "$container" pg_restore --exit-on-error --no-owner \
  --use-list /tmp/v5_synthetic_restore.filtered.list \
  -U postgres -d "$restored_db" < "$backup" > /dev/null

after="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" -c "$count_query")"
if [ "$before" != "$after" ]; then
  echo "::error::Synthetic backup/restore count reconciliation failed (values suppressed)"
  exit 1
fi
schema_after_hashes="$(schema_fingerprints "$restored_db" after)"
rows_after="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" < tests/sql/v5_synthetic_row_fingerprint.sql)"
acl_after="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" < tests/sql/v5_synthetic_acl_fingerprint.sql)"
checks_after="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" < tests/sql/v5_synthetic_check_constraint_fingerprint.sql)"
app_acl_after="$(docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" < tests/sql/v5_synthetic_app_acl_fingerprint.sql)"
if [ "$schema_before_hashes" != "$schema_after_hashes" ]; then
  for schema in public tutor_private auth supabase_migrations extensions; do
    before_hash="$(printf '%s\n' "$schema_before_hashes" | awk -F: -v name="$schema" '$1==name {print $2}')"
    after_hash="$(printf '%s\n' "$schema_after_hashes" | awk -F: -v name="$schema" '$1==name {print $2}')"
    if [ "$before_hash" != "$after_hash" ]; then
      echo "::error::Synthetic schema fingerprint differs for $schema"
      diff -u \
        "${RUNNER_TEMP}/v5_synthetic_schema_before_${schema}.sql" \
        "${RUNNER_TEMP}/v5_synthetic_schema_after_${schema}.sql" |
        grep -E '^[+-](CREATE|ALTER|DROP|COMMENT|GRANT|REVOKE)' |
        sed -E 's/^([+-])((CREATE|ALTER|DROP)[[:space:]]+(OR REPLACE[[:space:]]+)?(FUNCTION|TABLE|SEQUENCE|VIEW|TYPE|SCHEMA|EXTENSION|INDEX|TRIGGER|POLICY|MATERIALIZED VIEW)[[:space:]]+(ONLY[[:space:]]+)?[^[:space:](;]+).*/\1\2/; s/^([+-])((COMMENT ON|GRANT|REVOKE)[[:space:]]+[A-Z ]+[[:space:]]+[^[:space:](;]+).*/\1\2/' |
        head -n 20 || true
      echo "Sanitized schema dump delta categories for $schema (schema-only; values omitted):"
      { diff -u \
        "${RUNNER_TEMP}/v5_synthetic_schema_before_${schema}.sql" \
        "${RUNNER_TEMP}/v5_synthetic_schema_after_${schema}.sql" || true; } |
        grep -E '^[+-][^+-]' |
        sed -E 's#https?://[^[:space:]\047]+#[URL]#g; s#postgres(ql)?://[^[:space:]\047]+#[DB_URI]#g; s/(password|secret|token|key)[^,;)]*/\1=[REDACTED]/Ig; s/[A-Za-z0-9_+\/=-]{48,}/[LONG_VALUE]/g' |
        awk 'substr($0,1,1)=="+" {plus++} substr($0,1,1)=="-" {minus++} END {printf "added_lines=%d removed_lines=%d\n", plus, minus}'
      { diff -u \
        "${RUNNER_TEMP}/v5_synthetic_schema_before_${schema}.sql" \
        "${RUNNER_TEMP}/v5_synthetic_schema_after_${schema}.sql" || true; } |
        grep -E '^[+-][^+-]' |
        sed -E 's#https?://[^[:space:]\047]+#[URL]#g; s#postgres(ql)?://[^[:space:]\047]+#[DB_URI]#g; s/(password|secret|token|key)[^,;)]*/\1=[REDACTED]/Ig; s/[A-Za-z0-9_+\/=-]{48,}/[LONG_VALUE]/g' |
        head -n 32 | cut -c 1-260 || true
    fi
  done
  echo "::error::Synthetic restore schema/RLS/function fingerprint mismatch"
  exit 1
fi
if [ "$rows_before" != "$rows_after" ]; then
  echo "::error::Synthetic restore row fingerprint mismatch (values suppressed)"
  exit 1
fi
# Strictly refuse *any* application-owned object owner / ACL drift.
# These are the public + tutor_private schemas, including SECURITY DEFINER
# functions; unlike Supabase's internal platform-managed schemas they must be
# perfectly restorable with the restricted, --no-owner logical restore route.
if [ "$app_acl_before" != "$app_acl_after" ]; then
  echo "::error::Application-owned public/tutor_private owner or ACL fingerprint differs after restore"
  exit 1
fi
# Independent full-catalog diagnostic: do not falsely assert exact platform
# restoration where Supabase prevents changing protected internal owners.
# This drift is allowed ONLY in the internal auth/supabase_migrations/extensions
# schemas because app-owned schemas have already passed their strict gate.
if [ "$acl_before" != "$acl_after" ]; then
  python3 - "$acl_before" "$acl_after" <<'PY'
import json
import sys

before, after = (json.loads(value) for value in sys.argv[1:3])
for category in sorted(set(before) | set(after)):
    if before.get(category) != after.get(category):
        left, right = before.get(category, {}), after.get(category, {})
        print(
            f"Managed-schema ACL fingerprint category differs: {category}; "
            f"before_count={left.get('count', 'missing')}; "
            f"after_count={right.get('count', 'missing')}"
        )
PY
  echo "::warning::FULL PLATFORM OWNER/ACL RESTORE BLOCKED: Supabase protected internal owners differ after --no-owner; this rehearsal asserts only application-owned ACL parity, not a complete Production recovery"
else
  echo "Full object ACL fingerprint also matches the original disposable database"
fi
if [ "$checks_before" != "$checks_after" ]; then
  echo "::error::Synthetic restore parsed CHECK-constraint fingerprint mismatch"
  exit 1
fi
echo "SYNTHETIC APPLICATION-SCOPE RESTORE PASS: disposable localhost pg_dump/pg_restore, app-owned public/tutor_private owner and ACL exact parity"
echo "Validated selected schema/RLS/functions, parsed CHECK trees, migration/auth/V4/V5 row hashes and counts; removed backup on exit."
echo "Platform auth/supabase_migrations/extensions owner/ACL exact restoration remains BLOCKED where owner differs; platform DEFAULT ACL entries excluded."
echo "Scope: public and tutor_private security strict; auth, supabase_migrations and extensions schema/data strict, platform owner/ACL advisory only. Realtime/Storage excluded."
echo "NOT a full system recovery PASS, not a Production backup and not proof of restored Production roles or services."
