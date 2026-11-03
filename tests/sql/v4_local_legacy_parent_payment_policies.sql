-- TEST ONLY: intentionally restore unsafe historical parent payment SELECT predicates.
-- NEVER apply to hosted Supabase/Production. Only run through CI Docker container
-- supabase_db_tutor_v4_isolated with local project_id=tutor_v4_isolated.
-- These predicates mirror the read-only observed 2026-11-04 Production policies.
-- CI immediately runs a standalone guarded P0 hotfix + real local JWT acceptance.
BEGIN;
DO $safety$
DECLARE p_count integer;
DECLARE r_count integer;
BEGIN
  SELECT count(*) INTO p_count
    FROM pg_policies
    WHERE schemaname='public' AND cmd='SELECT'
      AND (tablename,policyname) IN (
       ('payment_batches','batch_read_by_teacher_or_parent'),
       ('payment_batch_items','items_read_by_batch_participant'),
       ('family_requests','requests_teacher_or_parent_view'))
      AND qual LIKE '%student_guardians%';
  IF p_count <> 3 THEN
    RAISE EXCEPTION 'TEST baseline requires three active-link V4 policies, got %',p_count;
  END IF;
  SELECT count(*) INTO r_count
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('payment_batches','payment_batch_items','family_requests','student_guardians')
      AND c.relrowsecurity;
  IF r_count <> 4 THEN
    RAISE EXCEPTION 'TEST baseline requires all four RLS tables enabled, got %',r_count;
  END IF;
END;
$safety$;

DROP POLICY IF EXISTS batch_read_by_teacher_or_parent ON public.payment_batches;
CREATE POLICY batch_read_by_teacher_or_parent
ON public.payment_batches FOR SELECT TO authenticated
USING (
 teacher_id=(SELECT auth.uid()) OR parent_id=(SELECT auth.uid())
);

DROP POLICY IF EXISTS items_read_by_batch_participant ON public.payment_batch_items;
CREATE POLICY items_read_by_batch_participant
ON public.payment_batch_items FOR SELECT TO authenticated
USING (
 EXISTS (SELECT 1 FROM public.payment_batches b
        WHERE b.id=payment_batch_items.batch_id
          AND (b.teacher_id=(SELECT auth.uid()) OR b.parent_id=(SELECT auth.uid())))
);

DROP POLICY IF EXISTS requests_teacher_or_parent_view ON public.family_requests;
CREATE POLICY requests_teacher_or_parent_view
ON public.family_requests FOR SELECT TO authenticated
USING (
 teacher_id=(SELECT auth.uid()) OR parent_id=(SELECT auth.uid())
);

DO $safety$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_policies
 WHERE schemaname='public' AND cmd='SELECT'
 AND (tablename,policyname) IN (
  ('payment_batches','batch_read_by_teacher_or_parent'),
  ('payment_batch_items','items_read_by_batch_participant'),
  ('family_requests','requests_teacher_or_parent_view'))
 AND qual NOT LIKE '%student_guardians%';
 IF n <> 3 THEN RAISE EXCEPTION 'TEST fixture did not restore three legacy predicates'; END IF;
END;
$safety$;
COMMIT;
