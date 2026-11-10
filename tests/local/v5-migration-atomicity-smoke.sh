#!/usr/bin/env bash
# CI-only failure injection for Supabase migration transaction atomicity.
# Uses a disposable local Supabase database and a temporary synthetic migration.
set -Eeuo pipefail
trap 'echo "::error::Synthetic migration atomicity probe failed (details suppressed)"' ERR

[[ "${GITHUB_ACTIONS:-}" == "true" && "${CI:-}" == "true" ]] || {
  echo "::error::This migration probe is restricted to GitHub CI"
  exit 1
}
[[ "${V4_E2E_LOCAL:-}" == "1" ]] || {
  echo "::error::Not in disposable Supabase mode"
  exit 1
}
grep -q '^project_id = "tutor_v4_isolated"$' supabase/config.toml || {
  echo "::error::Unexpected Supabase project identifier"
  exit 1
}
[[ ! -f supabase/.temp/project-ref && ! -f supabase/.branches/_current_branch ]] || {
  echo "::error::Linked or branched Supabase project detected"
  exit 1
}
[[ -n "${RUNNER_TEMP:-}" ]] || {
  echo "::error::Runner temp directory missing"
  exit 1
}

container="supabase_db_tutor_v4_isolated"
version="20261110110000"
probe="supabase/migrations/${version}_qa_atomicity_probe.sql"
failure_log="$RUNNER_TEMP/v5-migration-atomicity-failure.log"
retry_log="$RUNNER_TEMP/v5-migration-atomicity-retry.log"
repeat_log="$RUNNER_TEMP/v5-migration-atomicity-repeat.log"
probe_created=0
umask 077

[[ ! -e "$probe" ]] || {
  echo "::error::Refusing to overwrite an existing migration"
  exit 1
}
docker inspect "$container" --format '{{.State.Running}}' | grep -qx true
latest_version="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d postgres -c \
  'select max(version) from supabase_migrations.schema_migrations')"
[[ "$latest_version" == "20261110100000" ]] || {
  echo "::error::Unexpected migration baseline; expected the verified V5.7 head"
  exit 1
}

cleanup() {
  if [[ "$probe_created" == "1" ]]; then
    # This cleanup is limited to the synthetic CI database and this probe ID.
    docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "drop table if exists public.codex_v5_migration_atomicity_probe; delete from supabase_migrations.schema_migrations where version='${version}';" \
      >/dev/null 2>&1 || true
    rm -f "$probe"
  fi
  rm -f "$failure_log" "$retry_log" "$repeat_log"
}
trap cleanup EXIT

business_snapshot() {
  docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 \
    -U postgres -d postgres <<'SQL'
CREATE TEMP TABLE IF NOT EXISTS __v5_probe_session_seed (id integer);
DROP TABLE __v5_probe_session_seed;
CREATE OR REPLACE FUNCTION pg_temp.v5_qa_business_snapshot()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  item record;
  row_count bigint;
  row_md5 text;
  result jsonb := '{}'::jsonb;
BEGIN
  FOR item IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'tutor_private', 'auth')
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'codex_v5_migration_atomicity_probe'
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      'SELECT count(*)::bigint, md5(coalesce(string_agg(to_jsonb(r)::text, E''\\n'' ORDER BY to_jsonb(r)::text), '''')) FROM %I.%I r',
      item.nspname, item.relname
    ) INTO row_count, row_md5;
    result := result || jsonb_build_object(
      format('%s.%s', item.nspname, item.relname),
      jsonb_build_object('rows', row_count, 'row_md5', row_md5)
    );
  END LOOP;
  RETURN result::text;
END;
$function$;
SELECT pg_temp.v5_qa_business_snapshot();
SQL
}

before_snapshot="$(business_snapshot)"
test -n "$before_snapshot"

cat > "$probe" <<'SQL'
CREATE TABLE public.codex_v5_migration_atomicity_probe (
  id integer PRIMARY KEY,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0)
);
INSERT INTO public.codex_v5_migration_atomicity_probe (id, amount_cents)
VALUES (1, 7300);
DO $failure$
BEGIN
  RAISE EXCEPTION 'intentional synthetic migration failure after DDL and DML';
END;
$failure$;
SQL
probe_created=1

if supabase migration up --local >"$failure_log" 2>&1; then
  echo "::error::Injected migration unexpectedly succeeded"
  exit 1
fi

failed_state="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d postgres -c \
  "select (to_regclass('public.codex_v5_migration_atomicity_probe') is null and not exists (select 1 from supabase_migrations.schema_migrations where version='${version}'))::text")"
[[ "$failed_state" == "true" ]] || {
  echo "::error::Failed migration left a table or migration-history row"
  exit 1
}
after_failure_snapshot="$(business_snapshot)"
[[ "$before_snapshot" == "$after_failure_snapshot" ]] || {
  echo "::error::Failed migration changed synthetic V4/V5/auth business rows"
  exit 1
}

# Correct the same temporary version, then prove retry and repeated-up no-op.
cat > "$probe" <<'SQL'
CREATE TABLE public.codex_v5_migration_atomicity_probe (
  id integer PRIMARY KEY,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0)
);
INSERT INTO public.codex_v5_migration_atomicity_probe (id, amount_cents)
VALUES (1, 7300);
SQL

if ! supabase migration up --local >"$retry_log" 2>&1; then
  echo "::error::Corrected synthetic migration did not retry successfully"
  exit 1
fi

retry_state="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d postgres -c \
  "select (count(*) = 1 and min(amount_cents) = 7300 and max(amount_cents) = 7300)::text from public.codex_v5_migration_atomicity_probe")"
[[ "$retry_state" == "true" ]] || {
  echo "::error::Corrected retry did not apply exactly one synthetic row"
  exit 1
}
history_count="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d postgres -c \
  "select count(*) from supabase_migrations.schema_migrations where version='${version}'")"
[[ "$history_count" == "1" ]] || {
  echo "::error::Corrected migration history was not recorded exactly once"
  exit 1
}

if ! supabase migration up --local >"$repeat_log" 2>&1; then
  echo "::error::Repeated migration up failed"
  exit 1
fi
repeat_state="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d postgres -c \
  "select (count(*) = 1 and min(amount_cents) = 7300 and max(amount_cents) = 7300)::text from public.codex_v5_migration_atomicity_probe")"
history_count_after_repeat="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d postgres -c \
  "select count(*) from supabase_migrations.schema_migrations where version='${version}'")"
[[ "$repeat_state" == "true" && "$history_count_after_repeat" == "1" ]] || {
  echo "::error::Repeated migration up duplicated or changed the synthetic operation"
  exit 1
}
after_retry_snapshot="$(business_snapshot)"
[[ "$before_snapshot" == "$after_retry_snapshot" ]] || {
  echo "::error::Probe retry changed V4/V5/auth business rows"
  exit 1
}

echo "PASS: synthetic migration DDL/DML rolled back atomically, retried once, and repeated-up was idempotent"
echo "PASS: V4/V5/auth row fingerprints were unchanged by failed and repeated probe runs"

