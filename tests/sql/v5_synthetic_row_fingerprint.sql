-- TEST ONLY: emits row counts and hashes, never business row values.
-- Run only against the disposable synthetic CI database and its restored copy.
CREATE TEMP TABLE IF NOT EXISTS __v5_fingerprint_session_seed (id integer);
DROP TABLE __v5_fingerprint_session_seed;

CREATE OR REPLACE FUNCTION pg_temp.v5_synthetic_row_fingerprint()
RETURNS jsonb
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
    WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations', 'extensions')
      AND c.relkind IN ('r', 'p')
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
  RETURN result;
END;
$function$;
SELECT pg_temp.v5_synthetic_row_fingerprint();

