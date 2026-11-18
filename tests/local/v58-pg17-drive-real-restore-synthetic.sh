#!/usr/bin/env bash
# Synthetic PostgreSQL17 dump -> age -> mock/real Google Drive -> isolated pg_restore.
# NEVER uses Supabase Production and NEVER deletes Drive files.
set -Eeuo pipefail
set +x
umask 077

mode="${V58_PG17_MODE:-}"
[[ "$mode" == "mock" || "$mode" == "real" ]] || { echo 'NO_GO: expected mock or real mode' >&2; exit 2; }
[[ "${CI:-}" == 'true' && "${GITHUB_ACTIONS:-}" == 'true' ]] || { echo 'NO_GO: CI only' >&2; exit 2; }
for secret in SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL DATABASE_URL PGHOST PGPASSWORD PGPASSFILE AGE_SECRET_KEY; do
  [[ -z "${!secret:-}" ]] || { echo 'NO_GO: production/host DB credentials prohibited' >&2; exit 2; }
done
for cmd in docker age age-keygen sha256sum node; do
  command -v "$cmd" >/dev/null || { echo "NO_GO: missing tool $cmd" >&2; exit 2; }
done
if [[ "$mode" == real ]]; then
  [[ "${GITHUB_REF:-}" == 'refs/heads/main' && "${GITHUB_EVENT_NAME:-}" == 'workflow_dispatch' ]] ||
    { echo 'NO_GO: real OAuth restricted to manual main' >&2; exit 2; }
  [[ -n "${GDRIVE_CLIENT_ID:-}" && -n "${GDRIVE_CLIENT_SECRET:-}" && -n "${GDRIVE_REFRESH_TOKEN:-}" && -n "${GDRIVE_FOLDER_ID:-}" ]] ||
    { echo 'NO_GO: protected OAuth or synthetic folder missing' >&2; exit 2; }
else
  for secret in GDRIVE_CLIENT_ID GDRIVE_CLIENT_SECRET GDRIVE_REFRESH_TOKEN; do
    [[ -z "${!secret:-}" ]] || { echo 'NO_GO: no secrets in PR mock job' >&2; exit 2; }
  done
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
scratch="$(mktemp -d /tmp/v58-pg17-iso-XXXXXX)"
chmod 700 "$scratch"
name="v58-pg17-iso-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

docker run -d --network none --name "$name" \
  -e POSTGRES_PASSWORD=synthetic_ci_only -e POSTGRES_DB=postgres postgres:17 >/dev/null
ready=0
for n in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 &&
     docker exec "$name" psql -X -U postgres -d postgres -At -c 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'NO_GO: PG17 synthetic container not ready' >&2; exit 2; }
[[ "$(docker exec "$name" pg_dump --version)" =~ 17\. ]] ||
  { echo 'NO_GO: PostgreSQL17 client required' >&2; exit 2; }

docker exec -i "$name" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA supabase_migrations;
CREATE SCHEMA tutor_private;
CREATE TABLE public.students(id integer PRIMARY KEY, label text NOT NULL);
CREATE TABLE tutor_private.receivables(id integer PRIMARY KEY, cents integer NOT NULL CHECK (cents >= 0));
CREATE TABLE auth.users(id integer PRIMARY KEY, fake_email text NOT NULL);
CREATE TABLE storage.objects(id integer PRIMARY KEY, fake_path text NOT NULL);
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO public.students VALUES (1,'SYNTHETIC_ONLY_NO_REAL_PII');
INSERT INTO tutor_private.receivables VALUES (1,425), (2,25);
INSERT INTO auth.users VALUES (1,'synthetic@example.invalid');
INSERT INTO storage.objects VALUES (1,'synthetic/never-uploaded');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20990101010101');
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_student_read ON public.students FOR SELECT USING (id = 1);
SQL

fingerprint_sql="SELECT concat_ws('|',
 (SELECT count(*) FROM public.students),
 (SELECT coalesce(sum(cents),0) FROM tutor_private.receivables),
 (SELECT count(*) FROM auth.users),
 (SELECT count(*) FROM storage.objects),
 (SELECT count(*) FROM supabase_migrations.schema_migrations),
 (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='students'),
 (SELECT relrowsecurity::int FROM pg_class WHERE oid='public.students'::regclass))"
source_fingerprint="$(docker exec "$name" psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "$fingerprint_sql")"
[[ "$source_fingerprint" == '1|450|1|1|1|1|1' ]] || { echo 'NO_GO: source synthetic fixture mismatch' >&2; exit 2; }

docker exec "$name" pg_dump -U postgres -d postgres --format=custom --no-owner --no-acl \
  --file=/tmp/v58-synthetic.dump
docker cp "$name:/tmp/v58-synthetic.dump" "$scratch/clear.dump" >/dev/null
chmod 600 "$scratch/clear.dump"
plaintext_sha="$(sha256sum "$scratch/clear.dump" | cut -d' ' -f1)"
age-keygen -o "$scratch/test-only-private-key.txt" >/dev/null 2>&1
chmod 600 "$scratch/test-only-private-key.txt"
recipient="$(age-keygen -y "$scratch/test-only-private-key.txt")"
[[ "$recipient" == age1* ]] || exit 2
age -r "$recipient" -o "$scratch/archive.age" "$scratch/clear.dump"
chmod 600 "$scratch/archive.age"
[[ "$(wc -c < "$scratch/archive.age")" -le 16000000 ]] ||
  { echo 'NO_GO: synthetic fixture exceeds size limit; production flow out of scope' >&2; exit 2; }
if grep -aFq 'SYNTHETIC_ONLY_NO_REAL_PII' "$scratch/archive.age"; then
  echo 'NO_GO: synthetic marker found in ciphertext' >&2; exit 2
fi
ciphertext_sha="$(sha256sum "$scratch/archive.age" | cut -d' ' -f1)"
rm -f "$scratch/clear.dump"

if [[ "$mode" == real ]]; then
  export V58_DRIVE_MODE='synthetic-only'
  export V58_SYNTHETIC_DOWNLOAD_PATH="$scratch/received.age"
  node "$repo/scripts/release/v58-gdrive-synthetic-roundtrip.mjs" "$scratch/archive.age"
else
  cp "$scratch/archive.age" "$scratch/received.age"
fi
[[ -f "$scratch/received.age" ]] || { echo 'NO_GO: received ciphertext missing' >&2; exit 2; }
[[ "$(sha256sum "$scratch/received.age" | cut -d' ' -f1)" == "$ciphertext_sha" ]] ||
  { echo 'NO_GO: ciphertext SHA mismatch' >&2; exit 2; }
rm -f "$scratch/archive.age"
age -d -i "$scratch/test-only-private-key.txt" -o "$scratch/restore.dump" "$scratch/received.age"
[[ "$(sha256sum "$scratch/restore.dump" | cut -d' ' -f1)" == "$plaintext_sha" ]] ||
  { echo 'NO_GO: decrypted PostgreSQL17 dump SHA mismatch' >&2; exit 2; }

docker exec "$name" createdb -U postgres v58_synthetic_restore
docker cp "$scratch/restore.dump" "$name:/tmp/v58-restore.dump" >/dev/null
docker exec "$name" pg_restore -U postgres -d v58_synthetic_restore \
  --no-owner --no-acl --exit-on-error /tmp/v58-restore.dump >/dev/null
restore_fingerprint="$(docker exec "$name" psql -X -U postgres -d v58_synthetic_restore -At -v ON_ERROR_STOP=1 -c "$fingerprint_sql")"
[[ "$source_fingerprint" == "$restore_fingerprint" && "$restore_fingerprint" == '1|450|1|1|1|1|1' ]] ||
  { echo 'NO_GO: restored synthetic rows, accounting or RLS mismatch' >&2; exit 2; }
echo "PASS: PostgreSQL17 synthetic dump -> age -> ${mode^^} transport -> age decrypt -> isolated PG17 restore"
echo 'PASS: synthetic students, accounting, auth/storage metadata, migration and RLS parity'
echo 'NOT TESTED: Supabase managed restore, Production database backup, daily schedule'
