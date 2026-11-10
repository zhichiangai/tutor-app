#!/usr/bin/env bash
# SYNTHETIC-ONLY selected-schema PostgreSQL pg_dump/pg_restore rehearsal.
# NEVER use this script with a hosted Production URL or production credentials.
set -euo pipefail
trap 'echo "::error::Synthetic restore setup/operation failed at line $LINENO (disposable CI only)"' ERR
[[ "${CI:-}" == "true" ]] || { echo "::error::Not in GitHub CI"; exit 1; }
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
test -n "$schema_before_hashes"
test -n "$rows_before"
test -n "$acl_before"
test -n "$checks_before"

# Keep the full synthetic dump in a private, short-lived runner file.
docker exec "$container" pg_dump --format=custom --no-owner \
  --schema=public --schema=tutor_private --schema=auth \
  --schema=supabase_migrations --schema=extensions \
  -U postgres -d postgres > "$backup"
test -s "$backup"
docker exec -i "$container" pg_restore --list < "$backup" > "$restore_list"
# Exclude only platform-managed DEFAULT ACL TOC entries; retain object ACLs.
sed -E '/^[0-9]+; .*DEFAULT ACL /s/^/; /' "$restore_list" > "$restore_list_filtered"
docker exec -i "$container" sh -c 'cat > /tmp/v5_synthetic_restore.filtered.list' \
  < "$restore_list_filtered"
docker exec "$container" createdb -U postgres "$restored_db"
# A fresh PostgreSQL database already has an empty "public" schema. pg_dump
# includes CREATE SCHEMA public, so remove ONLY the empty target database copy.
docker exec "$container" psql -X -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" -c 'DROP SCHEMA public CASCADE;' >/dev/null
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
if [ "$acl_before" != "$acl_after" ]; then
  python3 - "$acl_before" "$acl_after" <<'PY'
import json
import sys

before, after = (json.loads(value) for value in sys.argv[1:3])
for category in sorted(set(before) | set(after)):
    if before.get(category) != after.get(category):
        left, right = before.get(category, {}), after.get(category, {})
        print(
            f"ACL fingerprint category differs: {category}; "
            f"before_count={left.get('count', 'missing')}; "
            f"after_count={right.get('count', 'missing')}"
        )
PY
  echo "::error::BLOCKED: Supabase reserved-role protection prevents exact synthetic owner/ACL restoration in this CLI context"
  exit 1
fi
if [ "$checks_before" != "$checks_after" ]; then
  echo "::error::Synthetic restore parsed CHECK-constraint fingerprint mismatch"
  exit 1
fi
echo "SYNTHETIC SELECTED-SCHEMA RESTORE PASS: pg_dump/pg_restore succeeded in disposable localhost CI"
echo "Validated synthetic schema/RLS/functions, parsed CHECK constraints, object-level ACLs, migration/auth/V4/V5 row hashes and counts; removed backup on exit."
echo "Platform DEFAULT ACL entries were excluded because the disposable Supabase roles cannot restore them."
echo "Scope: public, tutor_private, auth, supabase_migrations and extensions. Realtime/Storage platform objects excluded."
echo "NOT a Production backup; NOT evidence of Production data recovery or exact 43-migration restore."
