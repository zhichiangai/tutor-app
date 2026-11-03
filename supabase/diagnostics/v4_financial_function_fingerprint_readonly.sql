-- READ ONLY. Production finance-function fingerprint captured on 2026-11-04 (Taipei).
-- Checks function identity, security mode and source definition hash only.
-- No personal, student, lesson, financial or credential values are selected.
-- MATCH is not permission to migrate: backup/restore, production-schema drift,
-- functional compatibility, guardian RLS and an approved rollback remain gates.
WITH expected(schema_name,function_name,signature,return_type,definition_md5) AS (
 VALUES
 ('tutor_private','submit_range_payment',
  'p_teacher_id uuid, p_student_id uuid, p_period_start date, p_period_end date, p_paid_on date, p_paid_amount numeric, p_note text',
  'uuid','1a2b0e76a06511fc6455b3d852f70a97'),
 ('tutor_private','review_range_payment',
  'p_batch_id uuid, p_confirm boolean, p_received_on date',
  'void','5fd9a1486095c7f142f565b42759d680'),
 ('tutor_private','guard_paid_lesson',
  '','trigger','316acb8483b05c2f5972764d65b969a2')
),
observed AS (
 SELECT n.nspname AS schema_name,p.proname AS function_name,
   pg_catalog.pg_get_function_identity_arguments(p.oid) AS signature,
   pg_catalog.pg_get_function_result(p.oid) AS return_type,
   p.prosecdef AS security_definer,
   md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5
 FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='tutor_private'
 AND p.proname IN ('submit_range_payment','review_range_payment','guard_paid_lesson')
)
SELECT e.schema_name,e.function_name,
 CASE WHEN o.function_name IS NULL THEN 'MISSING'
      WHEN o.signature IS DISTINCT FROM e.signature THEN 'SIGNATURE_DRIFT'
      WHEN o.return_type IS DISTINCT FROM e.return_type THEN 'RETURN_TYPE_DRIFT'
      WHEN o.security_definer IS DISTINCT FROM true THEN 'SECURITY_MODE_DRIFT'
      WHEN o.definition_md5 IS DISTINCT FROM e.definition_md5 THEN 'DEFINITION_DRIFT'
      ELSE 'MATCH' END AS fingerprint_status,
 o.definition_md5 AS current_md5,
 e.definition_md5 AS baseline_md5
FROM expected e
LEFT JOIN observed o ON o.schema_name=e.schema_name AND o.function_name=e.function_name
ORDER BY e.function_name;
