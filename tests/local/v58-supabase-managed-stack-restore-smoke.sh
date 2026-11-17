#!/usr/bin/env bash
# Disposable local full Supabase stack smoke; SYNTHETIC fixtures only.
set -euo pipefail
set +x
umask 077
[[ "$CI" == "true" && "$V58_MANAGED_STACK_LOCAL" == "1" ]] || {
  echo 'REFUSED: disposable GitHub CI environment required' >&2; exit 2;
}
if [[ -v SUPABASE_ACCESS_TOKEN || -v V58_PRIVATE_DB_URL || -v PGPASSWORD ]]; then
  echo 'REFUSED: hosted secrets/connection settings are disallowed' >&2; exit 2
fi
db=supabase_db_tutor_v58_managed_restore
docker inspect "$db" >/dev/null 2>&1 || { echo 'FAIL: disposable Supabase DB missing' >&2; exit 2; }
[[ "$(docker inspect -f '{{.State.Running}}' "$db")" == true ]] || exit 2
test "$(docker exec "$db" psql -X -U postgres -d postgres -At -c 'select current_database()')" = postgres
# This requires the platform-managed Auth/Storage tables to exist in the target.
ready="$(docker exec "$db" psql -X -U postgres -d postgres -At -c "select (to_regclass('auth.users') is not null)::int,(to_regclass('storage.objects') is not null)::int")"
test "$ready" = '1|1' || { echo 'FAIL: initialized Auth/Storage schemas are absent' >&2; exit 1; }
# Verify BOTH actual local services, not merely similarly named database schemas.
for service in auth storage; do
  container="supabase_${service}_tutor_v58_managed_restore"
  docker inspect "$container" >/dev/null 2>&1 || {
    echo "FAIL: local Supabase $service service container missing" >&2; exit 1;
  }
  [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == true ]] || {
    echo "FAIL: local Supabase $service service is not running" >&2; exit 1;
  }
done
echo 'PASS: disposable GoTrue Auth and Storage API service containers running'
work="$(mktemp -d)"
chmod 700 "$work"
cleanup() {
  docker exec "$db" rm -f /tmp/v58-synthetic.archive /tmp/v58-synthetic.app-list >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
before="$(docker exec "$db" psql -X -At -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
select (select count(*) from auth.users),
       (select count(*) from storage.objects),
       (select count(*) from pg_tables where schemaname='auth'),
       (select count(*) from pg_tables where schemaname='storage'),
       (select count(*) from pg_extension),
       (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and not t.tgisinternal)")"
# Create a SEPARATE synthetic SOURCE database inside this disposable container.
docker exec "$db" createdb -U postgres -T template0 v58_synthetic_source
docker exec -i "$db" psql -X -U postgres -d v58_synthetic_source -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA supabase_migrations;
CREATE SCHEMA tutor_private;
CREATE TABLE auth.users(id integer PRIMARY KEY);
CREATE TABLE storage.objects(id integer PRIMARY KEY);
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO auth.users VALUES (777);
INSERT INTO storage.objects VALUES (888);
INSERT INTO supabase_migrations.schema_migrations VALUES ('synthetic-migration-only');
CREATE TABLE public.v58_synthetic_restore_items(id integer PRIMARY KEY, label text);
CREATE TABLE public.v58_synthetic_restore_audit(id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, item_id integer);
CREATE FUNCTION public.v58_synthetic_restore_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.v58_synthetic_restore_audit(item_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER v58_synthetic_restore_audit AFTER INSERT ON public.v58_synthetic_restore_items
 FOR EACH ROW EXECUTE FUNCTION public.v58_synthetic_restore_audit_fn();
CREATE TABLE tutor_private.v58_synthetic_restore_fees(id integer PRIMARY KEY, cents integer NOT NULL);
INSERT INTO public.v58_synthetic_restore_items VALUES (1,'fake lesson'),(2,'fake payment');
INSERT INTO tutor_private.v58_synthetic_restore_fees VALUES (1,100);
ALTER TABLE public.v58_synthetic_restore_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY v58_synthetic_allow_first ON public.v58_synthetic_restore_items
 FOR SELECT USING (id=1);
SQL
docker exec "$db" pg_dump -U postgres -d v58_synthetic_source --format=custom   --no-owner --no-acl --file=/tmp/v58-synthetic.archive
docker exec "$db" pg_restore --list /tmp/v58-synthetic.archive > "$work/source.toc"
# Negative proof against the real initialized LOCAL Supabase target:
# raw schema restore MUST fail on platform Auth schema; a single transaction
# ensures this synthetic attempt cannot leave partial DDL in target.
if docker exec "$db" pg_restore -U postgres -d postgres --schema-only      --no-owner --no-acl --single-transaction --exit-on-error      /tmp/v58-synthetic.archive >"$work/raw-restore-expected-failure.log" 2>&1; then
  echo 'FAIL: unfiltered archive unexpectedly accepted by initialized platform' >&2
  exit 1
fi
if ! grep -q 'schema "auth" already exists' "$work/raw-restore-expected-failure.log"; then
  echo 'FAIL: unexpected unfiltered restore failure reason' >&2
  exit 1
fi
echo 'PASS: full Supabase target rejects raw managed-schema DDL atomically (expected negative)'
node --input-type=module - "$work/source.toc" "$work/app-only.list" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {buildManagedAppRestorePlan} from './scripts/release/v58-managed-restore-plan.mjs';
const p=buildManagedAppRestorePlan(readFileSync(process.argv[2],'utf8'));
if(p.status!=='APP_ONLY_RESTORE_PROPOSAL_NOT_EXECUTABLE') {
  throw Error('Blocked unreviewed TOC categories: '+p.unreviewed_categories.join(','));
}
if(p.managed_auth_storage_data_restored||p.role_sql_restored||p.full_supabase_restore_verified)
  throw Error('Invalid restore completeness status');
writeFileSync(process.argv[3],p.toc,{flag:'wx',mode:0o600});
console.log('PASS: reviewed app-only TOC proposal; managed objects intentionally excluded');
JS
docker cp "$work/app-only.list" "$db:/tmp/v58-synthetic.app-list"
# No --clean, no platform table writes, and atomic restore to LOCAL disposable target.
docker exec "$db" pg_restore -U postgres -d postgres --no-owner --no-acl   --single-transaction --exit-on-error --use-list=/tmp/v58-synthetic.app-list   /tmp/v58-synthetic.archive >/dev/null
after="$(docker exec "$db" psql -X -At -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
select (select count(*) from auth.users),
       (select count(*) from storage.objects),
       (select count(*) from pg_tables where schemaname='auth'),
       (select count(*) from pg_tables where schemaname='storage'),
       (select count(*) from pg_extension),
       (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and not t.tgisinternal)")"
test "$after" = "$before" || { echo 'FAIL: initialized Supabase managed catalog changed' >&2; exit 1; }
app="$(docker exec "$db" psql -X -At -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
select (select count(*) from public.v58_synthetic_restore_items),
       (select count(*) from public.v58_synthetic_restore_audit),
       (select count(*) from tutor_private.v58_synthetic_restore_fees),
       (select count(*) from pg_policies where schemaname='public' and tablename='v58_synthetic_restore_items'),
       (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='v58_synthetic_restore_items' and not t.tgisinternal)")"
test "$app" = '2|2|1|1|1' || {
  echo 'FAIL: isolated app-only synthetic counts/RLS/Trigger mismatch' >&2; exit 1;
}
echo 'PASS: initialized local Supabase Auth/Storage tables remained intact'
echo 'PASS: app-only data, trigger, RLS and audit restored into disposable full-stack database'
echo 'PARTIAL: managed Auth/Storage contents, roles, extensions and migration-history reconciliation not restored'
echo 'NOT TESTED: any Production backup or full Production Supabase restore'
