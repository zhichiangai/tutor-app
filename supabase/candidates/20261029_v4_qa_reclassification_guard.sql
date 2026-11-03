-- CANDIDATE ONLY. Run after 20261029_v4_qa_real_payment_rpc_reconciliation.sql
-- on disposable local database. Do not use on Production until migration approved.
begin;

do $preflight$ begin
 if to_regclass('public.v4_payment_batch_qa_marks') is null
    or to_regprocedure('tutor_private.v4_guard_and_audit_payment_qa_mark()') is null then
   raise exception 'QA marker prerequisites missing: refusing reclassification guard';
 end if;
end;$preflight$;

create or replace function tutor_private.v4_guard_and_audit_payment_qa_mark()
returns trigger language plpgsql security definer set search_path=''
as $body$
declare
  v_actor uuid := (select auth.uid());
  v_teacher uuid;
  v_previous boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if tg_op='UPDATE' then
    if new.batch_id is distinct from old.batch_id then
      raise exception 'Cannot move a QA classification to another payment';
    end if;
    v_previous:=old.is_qa;
    if new.is_qa is not distinct from old.is_qa then
      raise exception 'Classification is unchanged';
    end if;
  end if;
  if new.is_qa is null or new.reason is null
     or char_length(btrim(new.reason)) not between 10 and 500 then
    raise exception 'QA classification requires a documented 10–500 character reason';
  end if;
  select b.teacher_id into v_teacher
  from public.payment_batches b where b.id=new.batch_id for update;
  if v_teacher is null or v_teacher is distinct from v_actor then
    raise exception 'Only the owning teacher can classify this payment';
  end if;
  -- Turning an audited simulation into real funds may not increase the
  -- remaining genuine allocated total beyond the amount billed for any lesson.
  -- Use the same student mutex as submit_range_payment to prevent races.
  if tg_op='UPDATE' and old.is_qa and not new.is_qa then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext((select b.student_id::text
        from public.payment_batches b where b.id=new.batch_id)));
    if exists(
      select 1 from public.payment_batch_items ti
      join public.lesson_records lesson on lesson.id=ti.lesson_id
      where ti.batch_id=new.batch_id and (
        select coalesce(sum(i.allocated_amount -
          case when b.status='confirmed' then coalesce((
            select sum(ci.amount) from public.payment_batch_correction_items ci
              where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0)
          else 0 end),0)
        from public.payment_batch_items i
        join public.payment_batches b on b.id=i.batch_id
        where i.lesson_id=lesson.id and b.status in ('pending','confirmed')
          and (b.id=new.batch_id or not exists(
            select 1 from public.v4_payment_batch_qa_marks qm
            where qm.batch_id=b.id and qm.is_qa))
      ) > lesson.total_amount+0.005
    ) then
      raise exception 'Reclassifying simulated QA payment would exceed genuine lesson tuition';
    end if;
  end if;
  new.classified_by:=v_actor;
  new.classified_at:=pg_catalog.clock_timestamp();
  insert into tutor_private.v4_payment_batch_qa_audit
    (batch_id,actor_id,previous_is_qa,new_is_qa,reason,changed_at)
  values (new.batch_id,v_actor,v_previous,new.is_qa,new.reason,new.classified_at);
  return new;
end;
$body$;

commit;
