-- CANDIDATE ONLY, requires both 20261028 and 20261029 QA marking candidates.
-- Read-only classification snapshot for authorized teachers and *currently linked*
-- guardians. NEVER return QA reasons, audit records, names, prices or other metadata.
-- SECURITY DEFINER deliberately bypasses the mark tables' teacher-only RLS;
-- ownership and active guardian links must be re-checked for every returned UUID.
-- Do not deploy until isolated authenticated/anon JWT/REST acceptance passes.
begin;

create or replace function public.v4_accounting_qa_snapshot()
returns jsonb
language sql stable security definer set search_path=''
as $function$
  with
  actor as (
    select (select auth.uid()) as user_id
  ),
  batch_marks as (
    select m.batch_id
    from public.v4_payment_batch_qa_marks m
    join public.payment_batches b on b.id=m.batch_id
    where m.is_qa
      and (select user_id from actor) is not null
      and (
        b.teacher_id=(select user_id from actor)
        or (
          b.parent_id=(select user_id from actor)
          and exists (
            select 1 from public.student_guardians g
            where g.guardian_id=(select user_id from actor)
              and g.teacher_id=b.teacher_id
              and g.student_id=b.student_id
              and g.workspace_id=b.workspace_id
          )
        )
      )
  ),
  lesson_marks as (
    select m.lesson_id,m.classification
    from public.v4_lesson_qa_marks m
    join public.lesson_records l on l.id=m.lesson_id
    where m.is_qa
      and (select user_id from actor) is not null
      and (
        l.owner_id=(select user_id from actor)
        or exists (
          select 1 from public.student_guardians g
          where g.guardian_id=(select user_id from actor)
            and g.teacher_id=l.owner_id
            and g.student_id=l.student_id
            and g.workspace_id=l.workspace_id
        )
      )
  )
  select jsonb_build_object(
    'qaBatchIds',
      (select coalesce(jsonb_agg(batch_id order by batch_id),'[]'::jsonb)
       from batch_marks),
    'qaLessonIds',
      (select coalesce(jsonb_agg(lesson_id order by lesson_id),'[]'::jsonb)
       from lesson_marks where classification='simulated_lesson'),
    'qaLegacyReceiptLessonIds',
      (select coalesce(jsonb_agg(lesson_id order by lesson_id),'[]'::jsonb)
       from lesson_marks where classification='simulated_legacy_receipt')
  );
$function$;

revoke all on function public.v4_accounting_qa_snapshot() from public, anon;
grant execute on function public.v4_accounting_qa_snapshot() to authenticated;

-- No QA marks are automatically created or applied to existing payment rows.
commit;
