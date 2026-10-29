-- CANDIDATE ONLY: test in disposable GitHub Actions Supabase, never Production.
-- Depends on all three V4 QA classification SQL candidates and 20261029024000.
begin;
do $preflight$ begin
 if to_regclass('public.v4_payment_batch_qa_marks') is null
    or to_regclass('public.v4_lesson_qa_marks') is null
    or to_regprocedure('tutor_private.submit_range_payment(uuid,uuid,date,date,date,numeric,text)') is null
    or to_regprocedure('tutor_private.review_range_payment(uuid,boolean,date)') is null then
   raise exception 'Missing QA classification or payment RPC dependencies';
 end if;
end; $preflight$;

create table tutor_private.v4_qa_payment_review_authorizations (
 id bigint generated always as identity primary key,
 lesson_id uuid not null references public.lesson_records(id) on delete restrict,
 teacher_id uuid not null references auth.users(id),
 txid bigint not null,
 batch_id uuid not null references public.payment_batches(id) on delete restrict,
 applied boolean not null default false,
 created_at timestamptz not null default pg_catalog.clock_timestamp(),
 unique(lesson_id,teacher_id,txid,batch_id)
);
alter table tutor_private.v4_qa_payment_review_authorizations enable row level security;
revoke all on tutor_private.v4_qa_payment_review_authorizations from public,anon,authenticated;

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
  -- Removing QA classification must never silently make simulated transfers
  -- count as real money beyond total tuition.
  if tg_op='UPDATE' and old.is_qa and not new.is_qa then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext((select b.student_id::text
        from public.payment_batches b where b.id=new.batch_id)));
    if exists(
      select 1 from public.payment_batch_items ti
      join public.lesson_records lesson on lesson.id=ti.lesson_id
      where ti.batch_id=new.batch_id and (
        select coalesce(sum(i.allocated_amount - case when b.status='confirmed'
          then coalesce((select sum(ci.amount) from public.payment_batch_correction_items ci
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
      raise exception 'Cannot reclassify QA payment: real lesson allocation would exceed tuition';
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

create or replace function tutor_private.guard_paid_lesson()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare
  v_has_payment_request boolean;
  v_has_live_batch boolean;
  v_has_any_batch boolean;
  v_confirmed numeric(12,2);
  v_financial_change boolean;
  v_old_paid boolean;
  v_reversal_id bigint;
  v_correction_id uuid;
  v_qa_review_id bigint;
begin
  -- Keep the list of billable facts in sync with the teacher's direct edit
  -- and the existing legacy payment protection. Learning-only fields are
  -- intentionally excluded so teachers can add feedback after settlement.
  v_financial_change :=
    (new.owner_id,new.student_id,new.lesson_date,new.start_time,new.end_time,
     new.hours,new.actual_start_time,new.actual_end_time,new.actual_hours,
     new.hourly_rate,new.total_amount,new.type)
    is distinct from
    (old.owner_id,old.student_id,old.lesson_date,old.start_time,old.end_time,
     old.hours,old.actual_start_time,old.actual_end_time,old.actual_hours,
     old.hourly_rate,old.total_amount,old.type);
  v_old_paid := old.status in ('老師已收到','家長已付款');
  select exists(select 1 from public.family_requests r
   where r.lesson_id=old.id and r.kind='payment'
     and r.status in ('pending','approved')) into v_has_payment_request;
  select
    exists(select 1 from public.payment_batch_items i
      join public.payment_batches b on b.id=i.batch_id
      where i.lesson_id=old.id and b.status in ('pending','confirmed')),
    exists(select 1 from public.payment_batch_items i where i.lesson_id=old.id)
  into v_has_live_batch,v_has_any_batch;

  if v_financial_change and (v_old_paid or v_has_payment_request or v_has_live_batch) then
    raise exception '已付款或收款課程不得直接修改時間、時數或金額；請先完成授權對帳程序';
  end if;

  -- Audited, once-only reconciliation when confirmed QA cash was not real.
  -- This cannot be created by browser roles or used for financial edits.
  if not v_financial_change and old.status='老師已收到'
     and new.status in ('老師已收到','未付款')
     and new.payment_date is not distinct from old.payment_date then
    update tutor_private.v4_qa_payment_review_authorizations a set applied=true
      where a.lesson_id=old.id and a.teacher_id=old.owner_id
        and a.txid=pg_catalog.txid_current() and not a.applied
        and exists(
          select 1 from public.payment_batches b
          join public.payment_batch_items i on i.batch_id=b.id
          where b.id=a.batch_id and b.teacher_id=a.teacher_id and b.status='confirmed'
            and i.lesson_id=a.lesson_id
            and not exists(select 1 from public.v4_payment_batch_qa_marks qm
              where qm.batch_id=b.id and qm.is_qa))
        and exists(
          select 1 from public.payment_batch_items qi
          join public.payment_batches qb on qb.id=qi.batch_id and qb.status='confirmed'
          join public.v4_payment_batch_qa_marks qm on qm.batch_id=qb.id and qm.is_qa
          where qi.lesson_id=a.lesson_id)
      returning a.id into v_qa_review_id;
    if v_qa_review_id is not null then return new; end if;
  end if;

  -- The attack is a status-only UPDATE followed by an otherwise permitted
  -- financial UPDATE. A paid status may NEVER silently fall back to unpaid.
  -- Only a correction RPC can create this one-use, transaction-local authorization.
  if old.status='老師已收到' and new.status='未付款'
    and new.received_date is null and not v_financial_change then
    update tutor_private.payment_correction_status_authorizations a
      set applied=true where a.lesson_id=old.id and a.teacher_id=old.owner_id
       and a.txid=pg_catalog.txid_current() and not a.applied
       and exists(select 1 from public.payment_batch_corrections c
         where c.id=a.correction_id and c.batch_id in
          (select i.batch_id from public.payment_batch_items i where i.lesson_id=old.id))
      returning a.correction_id into v_correction_id;
    if v_correction_id is not null then return new; end if;
  end if;
  if v_old_paid and new.status is distinct from old.status then
    if old.status='家長已付款' and new.status='老師已收到' then
      -- Normal teacher acknowledgment of payment; other protections apply.
      null;
    elsif new.status='未付款'
      and new.payment_date is null and new.received_date is null
      and not v_has_payment_request and not v_has_any_batch
      and not v_financial_change then
      -- The private authorization cannot be inserted by browser roles.
      -- Consume once; a second UPDATE in the same transaction cannot reuse it.
      update tutor_private.legacy_receipt_reversal_audit a
       set applied=true
       where a.id=(
        select x.id from tutor_private.legacy_receipt_reversal_audit x
        where x.lesson_id=old.id and x.teacher_id=old.owner_id
          and x.actor_id=(select auth.uid())
          and x.previous_status=old.status
          and x.authorized_txid=pg_catalog.txid_current()
          and not x.applied
        order by x.id desc limit 1 for update
       )
       returning a.id into v_reversal_id;
      if v_reversal_id is null then
        raise exception '禁止直接解除收款狀態；請使用授權且留有稽核紀錄的撤銷收款流程';
      end if;
    else
      raise exception '禁止直接解除或倒退已付款／已收款狀態；請先授權對帳';
    end if;
  end if;

  if v_old_paid and (new.payment_date,new.received_date)
    is distinct from (old.payment_date,old.received_date)
    and v_reversal_id is null
    and not (old.status='家長已付款' and new.status='老師已收到'
      and new.payment_date is not distinct from old.payment_date) then
    raise exception '已收款日期不可直接改寫；請走受控對帳流程';
  end if;

  -- Keep the original payment allocation guard (including partial batches).
  if v_has_live_batch and new.status is distinct from old.status then
    select coalesce(sum(i.allocated_amount),0) into v_confirmed
      from public.payment_batch_items i
      join public.payment_batches b on b.id=i.batch_id
      where i.lesson_id=old.id and b.status='confirmed';
    if new.status<>'老師已收到'
       or v_confirmed<new.total_amount-0.005 then
      raise exception 'Cannot manually override the payment status of an allocated lesson';
    end if;
  end if;
  return new;
end;$guard$;

create or replace function tutor_private.submit_range_payment(
 p_teacher_id uuid,p_student_id uuid,p_period_start date,p_period_end date,
 p_paid_on date,p_paid_amount numeric,p_note text
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_left numeric(12,2);
 v_available numeric(12,2);
 v_reserved numeric(12,2);
 v_sum numeric(12,2):=0;
 v_batch uuid;
 v_row record;
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 if p_teacher_id is null or p_student_id is null then raise exception 'Student and teacher are required'; end if;
 if p_period_start is null or p_period_end is null or p_period_start>p_period_end or p_period_end-p_period_start>730
 then raise exception 'Invalid date range'; end if;
 if p_paid_on is null or p_paid_on>(now() at time zone 'Asia/Taipei')::date then raise exception 'Payment date cannot be in the future'; end if;
 if p_paid_amount is null or p_paid_amount<=0 or p_paid_amount<>round(p_paid_amount,2) then raise exception 'Invalid payment amount'; end if;
 if length(coalesce(p_note,''))>500 then raise exception 'Note too long'; end if;
 if not exists(
  select 1 from public.student_guardians g
  join public.students s on s.id=g.student_id and s.teacher_id=g.teacher_id
  where g.student_id=p_student_id and g.teacher_id=p_teacher_id and g.guardian_id=v_actor
 ) then raise exception 'Not authorized for this student'; end if;

 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_student_id::text));
 -- Lock all eligible lesson rows to keep the amount calculation stable.
 perform 1 from public.lesson_records l
  where l.student_id=p_student_id and l.owner_id=p_teacher_id
    and l.lesson_date between p_period_start and p_period_end
    and l.type='lesson'
  order by l.lesson_date,l.id for update;

 for v_row in
  select l.id,l.total_amount,l.status,l.lesson_date from public.lesson_records l
  where l.student_id=p_student_id and l.owner_id=p_teacher_id
    and l.lesson_date between p_period_start and p_period_end
    and l.type='lesson' and l.total_amount>0
    and not exists (select 1 from public.v4_lesson_qa_marks lm
      where lm.lesson_id=l.id and lm.is_qa and lm.classification='simulated_lesson')
    and l.status <> '家長已付款'
    and not exists(select 1 from public.family_requests r where r.lesson_id=l.id and r.kind='payment' and r.status in ('pending','approved'))
  order by l.lesson_date,l.id
 loop
  select coalesce(sum(i.allocated_amount - case when b.status='confirmed' then coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0) else 0 end),0) into v_reserved
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_row.id and b.status in ('pending','confirmed')
     and not exists (select 1 from public.v4_payment_batch_qa_marks qm
       where qm.batch_id=b.id and qm.is_qa);
  v_sum:=v_sum+greatest(v_row.total_amount-v_reserved,0);
 end loop;
 if v_sum=0 then raise exception 'No eligible unpaid lessons for this period'; end if;
 if p_paid_amount>v_sum+0.005 then raise exception 'Payment exceeds available unpaid amount'; end if;

 insert into public.payment_batches (teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,note)
 values (p_teacher_id,p_student_id,v_actor,p_period_start,p_period_end,p_paid_on,p_paid_amount,coalesce(p_note,''))
 returning id into v_batch;

 v_left:=p_paid_amount;
 for v_row in
  select l.id,l.total_amount from public.lesson_records l
  where l.student_id=p_student_id and l.owner_id=p_teacher_id
    and l.lesson_date between p_period_start and p_period_end
    and l.type='lesson' and l.total_amount>0
    and not exists (select 1 from public.v4_lesson_qa_marks lm
      where lm.lesson_id=l.id and lm.is_qa and lm.classification='simulated_lesson')
    and l.status <> '家長已付款'
    and not exists(select 1 from public.family_requests r where r.lesson_id=l.id and r.kind='payment' and r.status in ('pending','approved'))
  order by l.lesson_date,l.id
 loop
  exit when v_left <= 0;
  select coalesce(sum(i.allocated_amount - case when b.status='confirmed' then coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0) else 0 end),0) into v_reserved
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_row.id and b.status in ('pending','confirmed')
     and not exists (select 1 from public.v4_payment_batch_qa_marks qm
       where qm.batch_id=b.id and qm.is_qa);
  v_available:=least(v_left,greatest(v_row.total_amount-v_reserved,0));
  if v_available>0 then
   insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values(v_batch,v_row.id,v_available);
   v_left:=v_left-v_available;
  end if;
 end loop;
 if v_left>0.005 then raise exception 'Could not allocate full reported amount'; end if;
 return v_batch;
end; $$;

create or replace function tutor_private.review_range_payment(
 p_batch_id uuid,p_confirm boolean,p_received_on date
) returns void
language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_batch public.payment_batches%rowtype;
 v_item record;
 v_confirmed numeric(12,2);
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 select * into v_batch from public.payment_batches b where b.id=p_batch_id for update;
 if not found or v_batch.teacher_id<>v_actor or v_batch.status<>'pending'
 then raise exception 'Batch not found, already processed or not authorized'; end if;
 if p_confirm and (p_received_on is null or p_received_on>(now() at time zone 'Asia/Taipei')::date)
 then raise exception 'Actual receipt date is required and cannot be in the future'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_batch.student_id::text));
 if p_confirm and exists(select 1 from public.v4_payment_batch_qa_marks qm
    where qm.batch_id=p_batch_id and qm.is_qa) then
   raise exception 'QA simulated payment cannot be confirmed as real bank receipt';
 end if;
 if p_confirm then
   for v_item in
    select i.lesson_id,i.allocated_amount,l.total_amount,l.status,l.type
    from public.payment_batch_items i join public.lesson_records l on l.id=i.lesson_id
    where i.batch_id=p_batch_id for update of l
   loop
    if v_item.type<>'lesson' then raise exception 'Course status changed; review before confirming'; end if;
    if v_item.status='老師已收到' and not exists (
      select 1 from public.payment_batch_items qi
      join public.payment_batches qb on qb.id=qi.batch_id and qb.status='confirmed'
      join public.v4_payment_batch_qa_marks qm on qm.batch_id=qb.id and qm.is_qa
      where qi.lesson_id=v_item.lesson_id
    ) then raise exception 'This course has already been marked received'; end if;
    select coalesce(sum(i.allocated_amount-coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0)),0) into v_confirmed from public.payment_batch_items i
      join public.payment_batches b on b.id=i.batch_id
      where i.lesson_id=v_item.lesson_id and b.status in ('pending','confirmed')
      and not exists (select 1 from public.v4_payment_batch_qa_marks qm
        where qm.batch_id=b.id and qm.is_qa);
    if v_confirmed>v_item.total_amount+0.005 then raise exception 'Payment exceeds lesson total'; end if;
   end loop;
 end if;
 update public.payment_batches set status=case when p_confirm then 'confirmed' else 'declined' end,
    received_on=case when p_confirm then p_received_on else null end,
    confirmed_at=case when p_confirm then now() else null end
 where id=p_batch_id;
 if p_confirm then
   -- An earlier simulated QA confirmation may have marked this course paid.
   -- Only this confirmed real batch may authorize a one-time status reconciliation.
   insert into tutor_private.v4_qa_payment_review_authorizations
     (lesson_id,teacher_id,txid,batch_id)
   select distinct l.id,v_actor,pg_catalog.txid_current(),p_batch_id
   from public.lesson_records l
   join public.payment_batch_items bi on bi.lesson_id=l.id and bi.batch_id=p_batch_id
   where l.owner_id=v_actor and l.status='老師已收到'
     and exists (
       select 1 from public.payment_batch_items qi
       join public.payment_batches qb on qb.id=qi.batch_id and qb.status='confirmed'
       join public.v4_payment_batch_qa_marks qm on qm.batch_id=qb.id and qm.is_qa
       where qi.lesson_id=l.id);
  for v_item in select distinct lesson_id from public.payment_batch_items where batch_id=p_batch_id loop
   select coalesce(sum(i.allocated_amount-coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0)),0) into v_confirmed from public.payment_batch_items i
     join public.payment_batches b on b.id=i.batch_id
     where i.lesson_id=v_item.lesson_id and b.status='confirmed'
      and not exists (select 1 from public.v4_payment_batch_qa_marks qm
        where qm.batch_id=b.id and qm.is_qa);
   update public.lesson_records l set
     status=case when v_confirmed>=l.total_amount-0.005 then '老師已收到' else '未付款' end,
     received_date=case when v_confirmed>=l.total_amount-0.005 then p_received_on else null end,
     updated_at=now()
   where l.id=v_item.lesson_id and l.owner_id=v_actor;
  end loop;
 end if;
end; $$;

commit;
