#!/usr/bin/env bash
# V5.8 proof of cryptography + recoverability with SYNTHETIC data ONLY.
# Does NOT contact Google Drive or Supabase Production and has no credentials.
set -euo pipefail
set +x
umask 077
[[ "${CI:-}" == 'true' && "${GITHUB_ACTIONS:-}" == 'true' ]] || {
  echo 'REFUSED: synthetic GitHub CI only' >&2; exit 2;
}
for secret in SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL DATABASE_URL PGPASSWORD PGPASSFILE   GOOGLE_DRIVE_REFRESH_TOKEN GDRIVE_REFRESH_TOKEN GOOGLE_CLIENT_SECRET AGE_SECRET_KEY; do
  [[ -z "${!secret:-}" ]] || { echo 'REFUSED: no real secrets in the synthetic PoC' >&2; exit 2; }
done
for cmd in age age-keygen docker sha256sum; do
  command -v "$cmd" >/dev/null || { echo "REFUSED: required synthetic CLI missing: $cmd" >&2; exit 2; }
done
base="$(mktemp -d)"
chmod 700 "$base"
name="v58-drive-synthetic-$RANDOM-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$base"
}
trap cleanup EXIT
mkdir -m 700 "$base/mock-google-drive"
# Only synthetic credentials inside an unnetworked throwaway PostgreSQL.
docker run -d --network none --name "$name"   -e POSTGRES_PASSWORD=synthetic_ci_only   -e POSTGRES_DB=postgres postgres:17 >/dev/null
ready=0
for n in $(seq 1 50); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 &&
     docker exec "$name" psql -X -U postgres -At -c 'select 1' >/dev/null 2>&1; then
    sleep 1
    if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  fi
  sleep 1
done
test "$ready" -eq 1
docker exec -i "$name" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA tutor_private;
CREATE TABLE public.students(id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE tutor_private.receivables(id integer PRIMARY KEY, cents integer NOT NULL);
INSERT INTO public.students VALUES (1,'SYNTHETIC_V58_ONLY_NEVER_REAL_PII');
INSERT INTO tutor_private.receivables VALUES (1,425);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_student_visible ON public.students
 FOR SELECT USING (id=1);
SQL
docker exec "$name" pg_dump -U postgres -d postgres --format=custom   --no-owner --no-acl --file=/tmp/v58-dummy.dump
docker cp "$name:/tmp/v58-dummy.dump" "$base/plain.dump" >/dev/null
chmod 600 "$base/plain.dump"
# Generate ephemeral X25519 test-only keypair. The secret key is never
# committed, uploaded or printed; real release keys must be outside CI/Drive.
age-keygen -o "$base/ephemeral-key.txt" >/dev/null 2>&1
chmod 600 "$base/ephemeral-key.txt"
recipient="$(age-keygen -y "$base/ephemeral-key.txt")"
[[ "$recipient" == age1* ]] || exit 2
age -r "$recipient" -o "$base/archive.age" "$base/plain.dump"
chmod 600 "$base/archive.age"
grep -aq '^age-encryption.org/v1' "$base/archive.age"
if grep -aq 'SYNTHETIC_V58_ONLY_NEVER_REAL_PII' "$base/archive.age"; then
  echo 'FAIL: ciphertext contains synthetic marker in plaintext' >&2; exit 1
fi
source_digest="$(sha256sum "$base/plain.dump" | cut -d' ' -f1)"
cipher_digest="$(sha256sum "$base/archive.age" | cut -d' ' -f1)"
rm -f "$base/plain.dump"
# Mock Drive: only encrypted bytes cross the storage boundary. This does NOT
# claim that Google OAuth or the real Drive API is configured or exercised.
cp "$base/archive.age" "$base/mock-google-drive/v58-synthetic.age"
rm -f "$base/archive.age"
download_digest="$(sha256sum "$base/mock-google-drive/v58-synthetic.age" | cut -d' ' -f1)"
test "$cipher_digest" = "$download_digest"
age -d -i "$base/ephemeral-key.txt" -o "$base/restore.dump"   "$base/mock-google-drive/v58-synthetic.age"
test "$source_digest" = "$(sha256sum "$base/restore.dump" | cut -d' ' -f1)"
# Restore plaintext into ANOTHER disposable database, not the source.
docker exec "$name" createdb -U postgres v58_synthetic_restore
docker cp "$base/restore.dump" "$name:/tmp/v58-restore.dump" >/dev/null
docker exec "$name" pg_restore -U postgres -d v58_synthetic_restore   --no-owner --no-acl --exit-on-error /tmp/v58-restore.dump >/dev/null
row_count="$(docker exec "$name" psql -X -U postgres -d v58_synthetic_restore -At   -c "select (select count(*) from public.students), (select sum(cents) from tutor_private.receivables), (select count(*) from pg_policies where schemaname='public' and tablename='students')")"
test "$row_count" = '1|425|1'
echo 'PASS: actual PostgreSQL17 synthetic Custom Archive -> age X25519 encryption'
echo 'PASS: only ciphertext copied across MOCK Drive boundary, SHA-256 preserved'
echo 'PASS: age decrypt -> actual PostgreSQL17 restore, synthetic data and RLS parity'
echo 'NOT TESTED: real Google Drive API/OAuth, live backups, managed Supabase restore'
