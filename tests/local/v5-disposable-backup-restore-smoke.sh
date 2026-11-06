#!/usr/bin/env bash
# SYNTHETIC-ONLY PostgreSQL pg_dump/pg_restore rehearsal.
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
# The only permitted operations are Docker's disposable CI PostgreSQL container.
docker inspect "$container" --format '{{.State.Running}}' | grep -qx true
cleanup() {
  rm -f "$backup"
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

# Keep the full synthetic dump in a private, short-lived runner file.
docker exec "$container" pg_dump --format=custom --no-owner --no-privileges \
  -U postgres -d postgres > "$backup"
test -s "$backup"
docker exec -i "$container" pg_restore --list < "$backup" > /dev/null
docker exec "$container" createdb -U postgres "$restored_db"
# Restore into a distinct disposable database in the SAME LOCAL CI Postgres container.
docker exec -i "$container" pg_restore --exit-on-error --no-owner --no-privileges \
  -U postgres -d "$restored_db" < "$backup" > /dev/null

after="$(docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d "$restored_db" -c "$count_query")"
if [ "$before" != "$after" ]; then
  echo "::error::Synthetic backup/restore count reconciliation failed (values suppressed)"
  exit 1
fi
echo "SYNTHETIC BACKUP/RESTORE PASS: pg_dump/pg_restore succeeded in disposable localhost CI"
echo "Validated synthetic migration/auth/V4/V5 ledger row counts and removed backup on exit."
echo "NOT a Production backup; NOT evidence of Production data recovery or exact 43-migration restore."
