-- Run only after disposable fixture and all three QA candidate SQL files.
-- Uses simulated request.jwt.claim.sub; this is not a substitute for real GoTrue JWT.
do $test$
begin
  if has_function_privilege('anon','public.v4_accounting_qa_snapshot()','EXECUTE') then
    raise exception 'Anonymous caller may execute the QA snapshot';
  end if;
end $test$;

set role authenticated;
set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
do $test$
declare
 v_blocked boolean := false;
 v_data jsonb;
begin
  -- Teacher A owns both portions of the same lesson and may classify one QA.
  insert into public.v4_payment_batch_qa_marks
    (batch_id,is_qa,reason,classified_by)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',true,
    'Simulated confirmed transfer, not a bank deposit',
    '22222222-2222-2222-2222-222222222222');
  if (select classified_by from public.v4_payment_batch_qa_marks
      where batch_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
      is distinct from (select auth.uid()) then
    raise exception 'Client forged classified_by';
  end if;

  begin
    insert into public.v4_lesson_qa_marks
      (lesson_id,classification,is_qa,reason,classified_by)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','simulated_lesson',true,
      'All lesson teaching and cash in this case are synthetic',
      (select auth.uid()));
  exception when others then v_blocked:=true;
  end;
  if not v_blocked then
    raise exception 'Whole-lesson QA hid an unclassified confirmed batch';
  end if;

  -- Now the teacher classifies that synthetic batch too.
  insert into public.v4_payment_batch_qa_marks
    (batch_id,is_qa,reason,classified_by)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',true,
    'Simulated whole-lesson transfer without actual bank funds',
    (select auth.uid()));
  insert into public.v4_lesson_qa_marks
    (lesson_id,classification,is_qa,reason,classified_by)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','simulated_lesson',true,
    'Whole lesson is synthetic and explicitly reviewed by teacher',
    (select auth.uid()));
  insert into public.v4_lesson_qa_marks
    (lesson_id,classification,is_qa,reason,classified_by)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','simulated_legacy_receipt',true,
    'Legacy direct receipt was only a test and never deposited',
    (select auth.uid()));
  v_data:=public.v4_accounting_qa_snapshot();
  if jsonb_array_length(v_data->'qaBatchIds')<>2 or
     jsonb_array_length(v_data->'qaLessonIds')<>1 or
     jsonb_array_length(v_data->'qaLegacyReceiptLessonIds')<>1 then
    raise exception 'Teacher QA snapshot incorrect: %',v_data;
  end if;

  -- Permission/RLS denies teacher A from classifying teacher B's batch.
  v_blocked:=false;
  begin
    insert into public.v4_payment_batch_qa_marks
      (batch_id,is_qa,reason,classified_by)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',true,
      'Attempt to classify a different teacher batch',
      (select auth.uid()));
  exception when others then v_blocked:=true;
  end;
  if not v_blocked then raise exception 'Cross-teacher QA marking succeeded'; end if;
end $test$;

-- Linked parent may read only the boolean ID snapshot, NOT the mark tables
-- (which include private reasons and audit metadata).
set request.jwt.claim.sub='33333333-3333-3333-3333-333333333333';
do $test$
declare v_data jsonb;
begin
  if (select count(*) from public.v4_payment_batch_qa_marks)<>0 then
    raise exception 'Parent can read teacher-only classification details';
  end if;
  v_data:=public.v4_accounting_qa_snapshot();
  if jsonb_array_length(v_data->'qaBatchIds')<>2
    or jsonb_array_length(v_data->'qaLessonIds')<>1
    or jsonb_array_length(v_data->'qaLegacyReceiptLessonIds')<>1 then
    raise exception 'Currently linked guardian snapshot not complete: %',v_data;
  end if;
end $test$;

set request.jwt.claim.sub='44444444-4444-4444-4444-444444444444';
do $test$
begin
  if jsonb_array_length(public.v4_accounting_qa_snapshot()->'qaBatchIds')<>0
    or jsonb_array_length(public.v4_accounting_qa_snapshot()->'qaLessonIds')<>0 then
    raise exception 'Unlinked guardian could read foreign QA classifications';
  end if;
end $test$;
set request.jwt.claim.sub='55555555-5555-5555-5555-555555555555';
do $test$
begin
  if jsonb_array_length(public.v4_accounting_qa_snapshot()->'qaBatchIds')<>0
    or jsonb_array_length(public.v4_accounting_qa_snapshot()->'qaLessonIds')<>0 then
    raise exception 'Student could read financial QA classification';
  end if;
end $test$;
reset role;

-- Simulate unlink as the privileged fixture owner; browser clients cannot do it.
delete from public.student_guardians
 where id='cccccccc-cccc-cccc-cccc-ccccccccccc1';

set role authenticated;
set request.jwt.claim.sub='33333333-3333-3333-3333-333333333333';
do $test$
begin
 if jsonb_array_length(public.v4_accounting_qa_snapshot()->'qaBatchIds')<>0
  or jsonb_array_length(public.v4_accounting_qa_snapshot()->'qaLegacyReceiptLessonIds')<>0 then
  raise exception 'Parent retained QA snapshot after unlink';
 end if;
end $test$;
reset role;

-- Audit is stored privately; no direct read or mutate grants for authenticated.
do $test$
begin
  if (select count(*) from tutor_private.v4_payment_batch_qa_audit)<>2
    or (select count(*) from tutor_private.v4_lesson_qa_audit)<>2 then
    raise exception 'Expected immutable QA marking audit rows';
  end if;
  if has_table_privilege('authenticated','tutor_private.v4_payment_batch_qa_audit','SELECT')
    or has_table_privilege('authenticated','tutor_private.v4_lesson_qa_audit','UPDATE') then
    raise exception 'Client may access private audit';
  end if;
  raise notice 'PASS isolated PostgreSQL QA classifier and linked/withdrawn parent snapshot tests';
end $test$;
