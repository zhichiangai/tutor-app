-- V3.5.2: A legacy receipt is financial history, even without a batch/request.
-- This migration is proposed for review ONLY; do not apply to Production before approval.
-- This migration never updates existing lesson/receipt/payment rows.
--
-- Authorized legacy-only reversal has an immutable private audit plus a
-- single-use, transaction-bound authorization consumed by the BEFORE trigger.
create table if not exists tutor_private.legacy_receipt_reversal_audit (
  id bigserial primary key,
  lesson_id uuid not null,
  teacher_id uuid not null,
  actor_id uuid not null,
  previous_status text not null,
  previous_payment_date date,
  previous_received_date date,
  reason text not null,
  authorized_txid bigint not null,
  applied boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on tutor_private.legacy_receipt_reversal_audit from public,anon,authenticated;
revoke all on sequence tutor_private.legacy_receipt_reversal_audit_id_seq from public,anon,authenticated;
create index if not exists idx_legacy_receipt_reversal_audit_transaction
 on tutor_private.legacy_receipt_reversal_audit
 (lesson_id,authorized_txid,actor_id) where not applied;

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

  -- The attack is a status-only UPDATE followed by an otherwise permitted
  -- financial UPDATE. A paid status may NEVER silently fall back to unpaid.
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

-- Authorized undo is intentionally limited to old-style, UNALLOCATED
-- receipts. Lessons referenced by any payment batch or active payment
-- request must be reconciled by their existing ledger flow instead.
create or replace function public.reverse_legacy_lesson_receipt(
 p_lesson_id uuid,p_expected_updated_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $reverse$
declare
 v_actor uuid:=(select auth.uid());
 v_lesson public.lesson_records%rowtype;
 v_reason text:=pg_catalog.btrim(coalesce(p_reason,''));
 v_current_rev timestamptz;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 if pg_catalog.char_length(v_reason)<10 or pg_catalog.char_length(v_reason)>500
 then raise exception '撤銷收款原因須為 10–500 字'; end if;
 if p_expected_updated_at is null then raise exception '缺少課程版本'; end if;
 select * into v_lesson from public.lesson_records l
 where l.id=p_lesson_id and l.owner_id=v_actor
 for update;
 if not found then raise exception '課程不存在或沒有撤銷權限'; end if;
 if v_lesson.updated_at is distinct from p_expected_updated_at
 then raise exception '資料已更新，請重新整理'; end if;
 if v_lesson.type<>'lesson'
   or v_lesson.status not in ('老師已收到','家長已付款')
 then raise exception '僅可撤銷本人已收款之舊式課程'; end if;
 if exists(select 1 from public.payment_batch_items i where i.lesson_id=p_lesson_id)
    or exists(select 1 from public.family_requests r
        where r.lesson_id=p_lesson_id and r.kind='payment'
          and r.status in ('pending','approved'))
 then
   raise exception '此課程已有付款申請或付款批次，請先依原付款流程對帳';
 end if;
 insert into tutor_private.legacy_receipt_reversal_audit(
  lesson_id,teacher_id,actor_id,previous_status,
  previous_payment_date,previous_received_date,reason,authorized_txid)
 values(p_lesson_id,v_lesson.owner_id,v_actor,v_lesson.status,
  v_lesson.payment_date,v_lesson.received_date,v_reason,pg_catalog.txid_current());
 update public.lesson_records
   set status='未付款',payment_date=null,received_date=null,
       updated_at=pg_catalog.clock_timestamp()
   where id=p_lesson_id and owner_id=v_actor
 returning updated_at into v_current_rev;
 if v_current_rev is null then raise exception '撤銷收款未成功'; end if;
 return pg_catalog.jsonb_build_object('id',p_lesson_id,
   'status','未付款','updated_at',v_current_rev);
end;$reverse$;
revoke all on function public.reverse_legacy_lesson_receipt(uuid,timestamptz,text)
 from public,anon;
grant execute on function public.reverse_legacy_lesson_receipt(uuid,timestamptz,text)
 to authenticated;
