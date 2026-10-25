-- Draft: transactionally correct confirmed batch allocations. No historic rows are rewritten.
create table tutor_private.payment_correction_status_authorizations (
 lesson_id uuid not null, teacher_id uuid not null, txid bigint not null,
 correction_id uuid not null references public.payment_batch_corrections(id),
 applied boolean not null default false,
 primary key(lesson_id,txid,correction_id)
);
revoke all on tutor_private.payment_correction_status_authorizations from public,anon,authenticated;

create or replace function public.v4_apply_payment_correction(
 p_batch_id uuid,p_idempotency_key uuid,p_reason text,p_lines jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid := (select auth.uid()); v_batch public.payment_batches%rowtype;
 v_reason text := pg_catalog.btrim(coalesce(p_reason,'')); v_hash text;
 v_existing public.payment_batch_corrections%rowtype;
 v_line record; v_original numeric(12,2); v_prior numeric(12,2);
 v_amount numeric(12,2):=0; v_correction uuid; v_count integer:=0;
 v_confirmed numeric(12,2); v_lesson public.lesson_records%rowtype;
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 if p_batch_id is null or p_idempotency_key is null then raise exception 'Batch and idempotency key required'; end if;
 if pg_catalog.char_length(v_reason) not between 10 and 500 then raise exception '更正原因須為 10–500 字'; end if;
 if pg_catalog.jsonb_typeof(p_lines)<>'array' or pg_catalog.jsonb_array_length(p_lines) not between 1 and 100
 then raise exception '請提供逐堂更正金額'; end if;
 -- Normalize order and text representation before hashing for safe retries.
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_lines) e
   where pg_catalog.jsonb_typeof(e)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(e))<>2
     or not (e ? 'lesson_id' and e ? 'amount'))
 then raise exception 'Invalid correction line'; end if;
 v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
   p_batch_id::text||':'||v_reason||':'||(
     select pg_catalog.string_agg((e->>'lesson_id')||'='||(e->>'amount'),'|' order by e->>'lesson_id')
     from pg_catalog.jsonb_array_elements(p_lines) e),'UTF8')),'hex');
 select * into v_batch from public.payment_batches where id=p_batch_id for update;
 if not found or v_batch.teacher_id<>v_actor or v_batch.status<>'confirmed'
 then raise exception '找不到本人已確認的付款批次'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_batch.student_id::text));
 select * into v_existing from public.payment_batch_corrections
 where batch_id=p_batch_id and idempotency_key=p_idempotency_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception '冪等識別碼已用於不同的更正內容'; end if;
  return pg_catalog.jsonb_build_object('id',v_existing.id,'amount',v_existing.amount,'replayed',true);
 end if;
 -- Lock the relevant lessons in deterministic order, matching payment serialization.
 perform 1 from public.lesson_records l where l.id in (
  select (e->>'lesson_id')::uuid from pg_catalog.jsonb_array_elements(p_lines) e)
 order by l.id for update;
 for v_line in select e->>'lesson_id' lesson_id,e->>'amount' amount
  from pg_catalog.jsonb_array_elements(p_lines) e order by e->>'lesson_id' loop
  if v_line.lesson_id is null or v_line.amount is null
    or v_line.amount !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
    or v_line.amount::numeric<=0 or v_line.amount::numeric>9999999999.99
  then raise exception '更正金額格式不正確'; end if;
  if not exists(select 1 from public.lesson_records l
    where l.id=v_line.lesson_id::uuid and l.owner_id=v_actor and l.student_id=v_batch.student_id and l.type='lesson')
  then raise exception '課程不屬於此付款批次'; end if;
  select i.allocated_amount into v_original from public.payment_batch_items i
   where i.batch_id=p_batch_id and i.lesson_id=v_line.lesson_id::uuid;
  if not found then raise exception '課程不屬於此付款批次'; end if;
  select coalesce(sum(ci.amount),0) into v_prior from public.payment_batch_correction_items ci
   where ci.batch_id=p_batch_id and ci.lesson_id=v_line.lesson_id::uuid;
  if v_prior+v_line.amount::numeric>v_original then raise exception '更正金額超過原始逐堂分配'; end if;
  v_amount:=v_amount+v_line.amount::numeric;
  v_count:=v_count+1;
 end loop;
 if v_count<>(select count(distinct e->>'lesson_id') from pg_catalog.jsonb_array_elements(p_lines) e)
 then raise exception '不可重複提交同一堂課'; end if;
 if v_amount+(select coalesce(sum(c.amount),0) from public.payment_batch_corrections c where c.batch_id=p_batch_id)>v_batch.paid_amount
 then raise exception '更正總額超過原始收款'; end if;
 insert into public.payment_batch_corrections(batch_id,idempotency_key,request_hash,reason,amount)
 values(p_batch_id,p_idempotency_key,v_hash,v_reason,v_amount) returning id into v_correction;
 insert into public.payment_batch_correction_items(correction_id,batch_id,lesson_id,amount)
 select v_correction,p_batch_id,(e->>'lesson_id')::uuid,(e->>'amount')::numeric
 from pg_catalog.jsonb_array_elements(p_lines) e;
 for v_line in select distinct (e->>'lesson_id')::uuid lesson_id
  from pg_catalog.jsonb_array_elements(p_lines) e order by 1 loop
  select * into v_lesson from public.lesson_records where id=v_line.lesson_id for update;
  select coalesce(sum(i.allocated_amount),0)-coalesce((
   select sum(ci.amount) from public.payment_batch_correction_items ci where ci.lesson_id=v_line.lesson_id),0)
   into v_confirmed from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_line.lesson_id and b.status='confirmed';
  if v_confirmed<v_lesson.total_amount and v_lesson.status='老師已收到' then
   insert into tutor_private.payment_correction_status_authorizations(lesson_id,teacher_id,txid,correction_id)
   values(v_line.lesson_id,v_actor,pg_catalog.txid_current(),v_correction);
   update public.lesson_records set status='未付款',received_date=null,updated_at=pg_catalog.clock_timestamp()
   where id=v_line.lesson_id;
  end if;
 end loop;
 return pg_catalog.jsonb_build_object('id',v_correction,'amount',v_amount,'replayed',false);
end $fn$;
revoke all on function public.v4_apply_payment_correction(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.v4_apply_payment_correction(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.v4_payment_correction_preview(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_actor uuid:=(select auth.uid()); v_batch public.payment_batches%rowtype;
 v_lines jsonb; v_total numeric(12,2);
begin
 if v_actor is null then raise exception '請先登入'; end if;
 select * into v_batch from public.payment_batches b
  where b.id=p_batch_id and b.teacher_id=v_actor and b.status='confirmed';
 if not found then raise exception '找不到本人已確認的付款批次'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('lesson_id',i.lesson_id,
  'original',i.allocated_amount,'corrected',coalesce(x.corrected,0),
  'net',i.allocated_amount-coalesce(x.corrected,0)) order by i.lesson_id),'[]'::jsonb),
  coalesce(sum(i.allocated_amount-coalesce(x.corrected,0)),0)
 into v_lines,v_total from public.payment_batch_items i
 left join lateral (select sum(ci.amount) corrected from public.payment_batch_correction_items ci
  where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id) x on true
 where i.batch_id=v_batch.id;
 return jsonb_build_object('batch_id',v_batch.id,'status',v_batch.status,
  'original',v_batch.paid_amount,'remaining',v_total,'lines',v_lines,'can_apply',v_total>0);
end $fn$;

-- Preserve legacy receipt guard and amend only the one-use correction path.
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

-- Recalculate V3 batch allocations against net confirmed receipts.
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
 if p_paid_on is null or p_paid_on>current_date then raise exception 'Payment date cannot be in the future'; end if;
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
    and l.status <> '家長已付款'
    and not exists(select 1 from public.family_requests r where r.lesson_id=l.id and r.kind='payment' and r.status in ('pending','approved'))
  order by l.lesson_date,l.id
 loop
  select coalesce(sum(i.allocated_amount - case when b.status='confirmed' then coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0) else 0 end),0) into v_reserved
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_row.id and b.status in ('pending','confirmed');
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
    and l.status <> '家長已付款'
    and not exists(select 1 from public.family_requests r where r.lesson_id=l.id and r.kind='payment' and r.status in ('pending','approved'))
  order by l.lesson_date,l.id
 loop
  exit when v_left <= 0;
  select coalesce(sum(i.allocated_amount - case when b.status='confirmed' then coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0) else 0 end),0) into v_reserved
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_row.id and b.status in ('pending','confirmed');
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
 if p_confirm and (p_received_on is null or p_received_on>current_date)
 then raise exception 'Actual receipt date is required and cannot be in the future'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_batch.student_id::text));
 if p_confirm then
   for v_item in
    select i.lesson_id,i.allocated_amount,l.total_amount,l.status,l.type
    from public.payment_batch_items i join public.lesson_records l on l.id=i.lesson_id
    where i.batch_id=p_batch_id for update of l
   loop
    if v_item.type<>'lesson' then raise exception 'Course status changed; review before confirming'; end if;
    if v_item.status='老師已收到' then raise exception 'This course has already been marked received'; end if;
    select coalesce(sum(i.allocated_amount-coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0)),0) into v_confirmed from public.payment_batch_items i
      join public.payment_batches b on b.id=i.batch_id
      where i.lesson_id=v_item.lesson_id and b.status in ('pending','confirmed');
    if v_confirmed>v_item.total_amount+0.005 then raise exception 'Payment exceeds lesson total'; end if;
   end loop;
 end if;
 update public.payment_batches set status=case when p_confirm then 'confirmed' else 'declined' end,
    received_on=case when p_confirm then p_received_on else null end,
    confirmed_at=case when p_confirm then now() else null end
 where id=p_batch_id;
 if p_confirm then
  for v_item in select distinct lesson_id from public.payment_batch_items where batch_id=p_batch_id loop
   select coalesce(sum(i.allocated_amount-coalesce((
      select sum(ci.amount) from public.payment_batch_correction_items ci
      where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id),0)),0) into v_confirmed from public.payment_batch_items i
     join public.payment_batches b on b.id=i.batch_id
     where i.lesson_id=v_item.lesson_id and b.status='confirmed';
   update public.lesson_records l set
     status=case when v_confirmed>=l.total_amount-0.005 then '老師已收到' else '未付款' end,
     received_date=case when v_confirmed>=l.total_amount-0.005 then p_received_on else null end,
     updated_at=now()
   where l.id=v_item.lesson_id and l.owner_id=v_actor;
  end loop;
 end if;
end; $$;
