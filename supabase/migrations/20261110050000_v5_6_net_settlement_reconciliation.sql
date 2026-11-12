-- V5.6 P0-B/D net settlement integration. DISPOSABLE CI ONLY.
-- Original confirmed source ledger is never rewritten. Production NO-GO.

create function tutor_private.v56_direct_net_for_lesson(p_lesson uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select (coalesce((select sum(a.amount_cents) from tutor_private.v5_team_payment_allocations a
 where a.lesson_id=p_lesson),0)-coalesce((select sum(r.amount_cents)
 from tutor_private.v56_team_direct_refund_reversals r where r.lesson_id=p_lesson),0))::bigint;
$$;
create function tutor_private.v56_advance_net_for_lesson(p_lesson uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(a.amount_cents),0)::bigint from tutor_private.v5_team_advance_applications a
 where a.lesson_id=p_lesson;
$$;
create function tutor_private.v56_credit_net_applied(p_credit uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(a.amount_cents),0)::bigint from tutor_private.v5_team_advance_applications a
 where a.credit_id=p_credit;
$$;
create function tutor_private.v56_credit_total_reserved(p_credit uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(q.amount_cents),0)::bigint from tutor_private.v56_team_credit_refund_requests q
 where q.credit_id=p_credit and exists(select 1 from tutor_private.v56_team_credit_refund_events e
 where e.request_id=q.id and e.event='approved');
$$;
create function tutor_private.v56_credit_available(p_credit uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select c.amount_cents-tutor_private.v56_credit_net_applied(c.id)
 -tutor_private.v56_credit_total_reserved(c.id)
 from tutor_private.v5_team_advance_credits c where c.id=p_credit;
$$;
revoke all on function tutor_private.v56_direct_net_for_lesson(uuid),
 tutor_private.v56_advance_net_for_lesson(uuid),tutor_private.v56_credit_net_applied(uuid),
 tutor_private.v56_credit_total_reserved(uuid),tutor_private.v56_credit_available(uuid)
 from public,anon,authenticated;

create or replace function tutor_private.v5_guard_combined_lesson_settlement()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 v_fee tutor_private.v5_team_lesson_fees%rowtype;
 v_direct bigint;
 v_advance bigint;
 v_team uuid;
 v_student uuid;
begin
 select * into v_fee from tutor_private.v5_team_lesson_fees
  where lesson_id=new.lesson_id;
 if not found then
  raise exception '找不到應收課程' using errcode='23514';
 end if;
 if tg_table_name='v5_team_payment_allocations' then
  select p.team_id,p.student_id into v_team,v_student
   from tutor_private.v5_team_payment_reports p where p.id=new.payment_id;
 else
  select c.team_id,c.student_id into v_team,v_student
   from tutor_private.v5_team_advance_credits c where c.id=new.credit_id;
 end if;
 if v_team is distinct from v_fee.team_id
  or v_student is distinct from v_fee.student_id then
  raise exception '不可跨 Team 或學生結清課程' using errcode='42501';
 end if;
 select tutor_private.v56_direct_net_for_lesson(new.lesson_id) into v_direct;
 select tutor_private.v56_advance_net_for_lesson(new.lesson_id) into v_advance;
 if v_direct+v_advance+new.amount_cents>v_fee.amount_cents then
  raise exception '直接分配與預收抵扣合計不得超過應收'
   using errcode='23514';
 end if;
 return new;
end;$$;
create or replace function public.v5_report_team_payment(
 p_team_id uuid,p_student_id uuid,p_amount_cents bigint,
 p_received_on date,p_method text,p_reference text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment uuid;
 v_due bigint;
 v_pending_direct bigint;
begin
 if v_actor is null or p_team_id is null or p_student_id is null
  or p_amount_cents is null or p_amount_cents not between 1 and 1000000000
  or p_received_on is null
  or p_received_on>(now() at time zone 'Asia/Taipei')::date
  or p_method is null or p_method not in('cash','bank_transfer','other')
  or p_reference is null or char_length(p_reference) not between 8 and 80
  or p_note is null or char_length(p_note)>250 then
  raise exception '付款登錄資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor from public.v5_teams t
  where t.id=p_team_id;
 if v_anchor is null then raise exception '找不到 Team' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '只有現任 Team 管理者可登錄付款'
   using errcode='42501';
 end if;
 if not exists(select 1 from public.v5_team_students s
   where s.id=p_student_id and s.team_id=p_team_id) then
  raise exception '學生不屬於此 Team' using errcode='42501';
 end if;
 select coalesce(sum(f.amount_cents-tutor_private.v56_direct_net_for_lesson(f.lesson_id)-
 tutor_private.v56_advance_net_for_lesson(f.lesson_id)),0)::bigint into v_due
 from tutor_private.v5_team_lesson_fees f where f.team_id=p_team_id and f.student_id=p_student_id;
 select coalesce(sum(p.amount_cents-coalesce(i.expected_credit_cents,0)),0)::bigint
 into v_pending_direct
 from tutor_private.v5_team_payment_reports p
 left join tutor_private.v5_team_advance_intents i on i.payment_id=p.id
 where p.team_id=p_team_id and p.student_id=p_student_id
  and p.status='pending'
  and not exists(select 1 from tutor_private.v56_team_pending_payment_voids v
    where v.payment_id=p.id);
 if p_amount_cents>v_due-v_pending_direct then
  raise exception '金額超過已確認且尚未結清的應收；超額請用預收款流程'
   using errcode='23514';
 end if;
 insert into tutor_private.v5_team_payment_reports(
  team_id,student_id,amount_cents,received_on,method,reference,note,reported_by)
 values(p_team_id,p_student_id,p_amount_cents,p_received_on,p_method,
  p_reference,p_note,v_actor) returning id into v_payment;
 insert into tutor_private.v5_team_payment_audit(
  team_id,payment_id,actor_id,event,amount_cents)
 values(p_team_id,v_payment,v_actor,'reported',p_amount_cents);
 return jsonb_build_object('payment_id',v_payment,'status','pending',
  'amount_cents',p_amount_cents,'currency','TWD');
end;$$;

create or replace function public.v5_report_team_payment_with_advance(
 p_team_id uuid,p_student_id uuid,p_amount_cents bigint,
 p_received_on date,p_method text,p_reference text,
 p_expected_credit_cents bigint,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment uuid;
 v_due bigint;
 v_pending_direct bigint;
 v_direct bigint;
begin
 if v_actor is null or p_team_id is null or p_student_id is null
  or p_amount_cents is null or p_amount_cents not between 1 and 1000000000
  or p_expected_credit_cents is null or p_expected_credit_cents<1
  or p_expected_credit_cents>p_amount_cents or p_received_on is null
  or p_received_on>(now() at time zone 'Asia/Taipei')::date
  or p_method not in('cash','bank_transfer','other') or p_method is null
  or p_reference is null or char_length(p_reference) not between 8 and 80
  or p_note is null or char_length(p_note)>250 then
  raise exception '預收款登錄資料不正確' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
  from public.v5_teams t where t.id=p_team_id;
 if v_anchor is null then
  raise exception '找不到 Team' using errcode='42501';
 end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
   join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
   where g.workspace_id=v_anchor and g.manager_user_id=v_actor
    and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可登錄預收'
   using errcode='42501';
 end if;
 if not exists(select 1 from public.v5_team_students s
   where s.team_id=p_team_id and s.id=p_student_id) then
  raise exception '學生不屬於 Team' using errcode='42501';
 end if;
 select coalesce(sum(f.amount_cents-tutor_private.v56_direct_net_for_lesson(f.lesson_id)-
 tutor_private.v56_advance_net_for_lesson(f.lesson_id)),0)::bigint into v_due
 from tutor_private.v5_team_lesson_fees f where f.team_id=p_team_id and f.student_id=p_student_id;
 select coalesce(sum(p.amount_cents-coalesce(i.expected_credit_cents,0)),0)::bigint
 into v_pending_direct
 from tutor_private.v5_team_payment_reports p
 left join tutor_private.v5_team_advance_intents i on i.payment_id=p.id
 where p.team_id=p_team_id and p.student_id=p_student_id
  and p.status='pending'
  and not exists(select 1 from tutor_private.v56_team_pending_payment_voids v
    where v.payment_id=p.id);
 v_direct:=p_amount_cents-p_expected_credit_cents;
 if v_direct>v_due-v_pending_direct then
  raise exception '直接分配部分超過可用應收，請減少金額'
   using errcode='23514';
 end if;
 insert into tutor_private.v5_team_payment_reports(
  team_id,student_id,amount_cents,received_on,method,reference,note,reported_by)
 values(p_team_id,p_student_id,p_amount_cents,p_received_on,p_method,
  p_reference,p_note,v_actor) returning id into v_payment;
 insert into tutor_private.v5_team_advance_intents(payment_id,expected_credit_cents)
 values(v_payment,p_expected_credit_cents);
 insert into tutor_private.v5_team_payment_audit(
  team_id,payment_id,actor_id,event,amount_cents,detail)
 values(p_team_id,v_payment,v_actor,'reported',p_amount_cents,
  jsonb_build_object('intended_credit_cents',p_expected_credit_cents));
 return jsonb_build_object('payment_id',v_payment,'status','pending',
  'amount_cents',p_amount_cents,'expected_credit_cents',p_expected_credit_cents,
  'currency','TWD');
end;$$;

create or replace function public.v5_confirm_team_payment_allocation(
 p_payment_id uuid,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment tutor_private.v5_team_payment_reports%rowtype;
 v_fee tutor_private.v5_team_lesson_fees%rowtype;
 v_item record;
 v_seen uuid[]:='{}'::uuid[];
 v_sum bigint:=0;
 v_applied bigint;
 v_detail jsonb:='[]'::jsonb;
begin
 if v_actor is null or p_payment_id is null or p_allocations is null
   or jsonb_typeof(p_allocations)<>'array'
   or jsonb_array_length(p_allocations) not between 1 and 100 then
  raise exception '付款分配清單無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_payment_reports p
 join public.v5_teams t on t.id=p.team_id where p.id=p_payment_id;
 if v_anchor is null then
  raise exception '找不到付款紀錄' using errcode='42501';
 end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team'
 ) then
  raise exception '只有現任 Team 管理者可確認付款分配'
    using errcode='42501';
 end if;
 select * into v_payment from tutor_private.v5_team_payment_reports p
 where p.id=p_payment_id for update;
 if not found or v_payment.status<>'pending' then
  raise exception '付款已確認或已失效' using errcode='23505';
 end if;
 if exists(select 1 from tutor_private.v56_team_pending_payment_voids v
  where v.payment_id=p_payment_id) then
  raise exception '此待確認付款已沖銷' using errcode='23505';
 end if;

 for v_item in
  select a.lesson_id,a.amount_cents
  from jsonb_to_recordset(p_allocations) as a(
   lesson_id uuid,amount_cents bigint)
  order by a.lesson_id
 loop
  if v_item.lesson_id is null or v_item.amount_cents is null
    or v_item.amount_cents<=0 or v_item.lesson_id=any(v_seen) then
   raise exception '分配金額不得為零、負數或重複課程'
    using errcode='23514';
  end if;
  v_seen:=array_append(v_seen,v_item.lesson_id);
  select * into v_fee from tutor_private.v5_team_lesson_fees f
  where f.lesson_id=v_item.lesson_id for update;
  if not found or v_fee.team_id<>v_payment.team_id
   or v_fee.student_id<>v_payment.student_id then
   raise exception '只能分配到同 Team 同學生的已確認應收課程'
    using errcode='42501';
  end if;
  select tutor_private.v56_direct_net_for_lesson(v_fee.lesson_id)+tutor_private.v56_advance_net_for_lesson(v_fee.lesson_id) into v_applied;
  if v_applied+v_item.amount_cents>v_fee.amount_cents then
   raise exception '課程分配超過尚未結清的應收金額'
    using errcode='23514';
  end if;
  if v_sum>v_payment.amount_cents-v_item.amount_cents then
   raise exception '付款分配總額超過付款金額'
    using errcode='23514';
  end if;
  v_sum:=v_sum+v_item.amount_cents;
  insert into tutor_private.v5_team_payment_allocations(
   payment_id,lesson_id,amount_cents)
  values(p_payment_id,v_fee.lesson_id,v_item.amount_cents);
  v_detail:=v_detail||jsonb_build_array(jsonb_build_object(
   'lesson_id',v_fee.lesson_id,'student_id',v_fee.student_id,
   'subject',v_fee.subject,'amount_cents',v_item.amount_cents));
 end loop;
 if v_sum<>v_payment.amount_cents then
  raise exception '必須完整分配付款金額，超額待 V5.4 預收款處理'
    using errcode='23514';
 end if;
 update tutor_private.v5_team_payment_reports p
 set status='confirmed',confirmed_by=v_actor,confirmed_at=now()
 where p.id=p_payment_id;
 insert into tutor_private.v5_team_payment_audit(
  team_id,payment_id,actor_id,event,amount_cents,detail)
 values(v_payment.team_id,p_payment_id,v_actor,'confirmed',
  v_payment.amount_cents,v_detail);
 return jsonb_build_object('payment_id',p_payment_id,
  'status','confirmed','allocated_cents',v_sum,
  'currency','TWD','allocations',v_detail);
end;$$;

create or replace function public.v5_confirm_team_advance_payment(
 p_payment_id uuid,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment tutor_private.v5_team_payment_reports%rowtype;
 v_credit_cents bigint;
 v_credit_id uuid;
 v_fee tutor_private.v5_team_lesson_fees%rowtype;
 v_row record;
 v_seen uuid[]:='{}'::uuid[];
 v_applied bigint;
 v_sum bigint:=0;
 v_details jsonb:='[]'::jsonb;
begin
 if v_actor is null or p_payment_id is null or p_allocations is null
  or jsonb_typeof(p_allocations)<>'array'
  or jsonb_array_length(p_allocations)>100 then
  raise exception '分配資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_payment_reports p
 join public.v5_teams t on t.id=p.team_id where p.id=p_payment_id;
 if v_anchor is null then raise exception '付款不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可確認預收' using errcode='42501';
 end if;
 select * into v_payment from tutor_private.v5_team_payment_reports
  where id=p_payment_id for update;
 if not found or v_payment.status<>'pending' then
  raise exception '此付款已確認或不存在' using errcode='23505';
 end if;
 if exists(select 1 from tutor_private.v56_team_pending_payment_voids v
  where v.payment_id=p_payment_id) then
  raise exception '此待確認預收已沖銷' using errcode='23505';
 end if;
 select expected_credit_cents into v_credit_cents
  from tutor_private.v5_team_advance_intents where payment_id=p_payment_id;
 if not found or v_credit_cents<1 then
  raise exception '此付款不是預收款專用報告' using errcode='23514';
 end if;
 for v_row in
  select a.lesson_id,a.amount_cents
  from jsonb_to_recordset(p_allocations) as a(lesson_id uuid,amount_cents bigint)
  order by a.lesson_id
 loop
  if v_row.lesson_id is null or v_row.amount_cents is null
   or v_row.amount_cents<=0 or v_row.lesson_id=any(v_seen) then
   raise exception '分配項目無效或重複' using errcode='23514';
  end if;
  v_seen:=array_append(v_seen,v_row.lesson_id);
  select * into v_fee from tutor_private.v5_team_lesson_fees
   where lesson_id=v_row.lesson_id for update;
  if not found or v_fee.team_id<>v_payment.team_id
   or v_fee.student_id<>v_payment.student_id then
   raise exception '不得跨 Team 或學生分配' using errcode='42501';
  end if;
  select tutor_private.v56_direct_net_for_lesson(v_fee.lesson_id)+tutor_private.v56_advance_net_for_lesson(v_fee.lesson_id) into v_applied;
  if v_applied+v_row.amount_cents>v_fee.amount_cents
    or v_sum>v_payment.amount_cents-v_row.amount_cents then
   raise exception '應收不足或付款金額超出' using errcode='23514';
  end if;
  v_sum:=v_sum+v_row.amount_cents;
  insert into tutor_private.v5_team_payment_allocations(
    payment_id,lesson_id,amount_cents)
   values(p_payment_id,v_fee.lesson_id,v_row.amount_cents);
  v_details:=v_details||jsonb_build_array(jsonb_build_object(
   'lesson_id',v_fee.lesson_id,'subject',v_fee.subject,
   'amount_cents',v_row.amount_cents));
 end loop;
 if v_sum<>v_payment.amount_cents-v_credit_cents then
  raise exception '直接分配加上預收必須等於付款金額'
   using errcode='23514';
 end if;
 insert into tutor_private.v5_team_advance_credits(
  payment_id,team_id,student_id,amount_cents,created_by)
 values(v_payment.id,v_payment.team_id,v_payment.student_id,v_credit_cents,v_actor)
 returning id into v_credit_id;
 update tutor_private.v5_team_payment_reports
  set status='confirmed',confirmed_by=v_actor,confirmed_at=now()
  where id=v_payment.id;
 insert into tutor_private.v5_team_payment_audit(
  team_id,payment_id,actor_id,event,amount_cents,detail)
 values(v_payment.team_id,v_payment.id,v_actor,'confirmed',v_payment.amount_cents,
  jsonb_build_object('direct_allocations',v_details,'advance_credit_id',v_credit_id,
   'advance_cents',v_credit_cents));
 insert into tutor_private.v5_team_advance_audit(
  team_id,student_id,payment_id,credit_id,actor_id,event,amount_cents)
 values(v_payment.team_id,v_payment.student_id,v_payment.id,
  v_credit_id,v_actor,'credit_created',v_credit_cents);
 return jsonb_build_object('status','confirmed','payment_id',v_payment.id,
  'credit_id',v_credit_id,'credit_cents',v_credit_cents,
  'allocated_cents',v_sum,'currency','TWD','allocations',v_details);
end;$$;

create or replace function public.v5_apply_team_advance_credit(
 p_credit_id uuid,p_allocations jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_credit tutor_private.v5_team_advance_credits%rowtype;
 v_prior tutor_private.v5_team_advance_operations%rowtype;
 v_fee tutor_private.v5_team_lesson_fees%rowtype;
 v_row record;
 v_seen uuid[]:='{}'::uuid[];
 v_balance bigint;
 v_refund_reserved bigint;
 v_paid bigint;
 v_total bigint:=0;
 v_op uuid;
 v_details jsonb:='[]'::jsonb;
begin
 if v_actor is null or p_credit_id is null or p_allocations is null
  or jsonb_typeof(p_allocations)<>'array'
  or jsonb_array_length(p_allocations) not between 1 and 100
  or p_idempotency_key is null
  or char_length(p_idempotency_key) not between 8 and 80 then
  raise exception '抵扣資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
  from tutor_private.v5_team_advance_credits c
  join public.v5_teams t on t.id=c.team_id where c.id=p_credit_id;
 if v_anchor is null then raise exception '預收款不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
    and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可抵扣預收' using errcode='42501';
 end if;
 select * into v_credit from tutor_private.v5_team_advance_credits
  where id=p_credit_id for update;
 select * into v_prior from tutor_private.v5_team_advance_operations
  where credit_id=p_credit_id and idempotency_key=p_idempotency_key;
 if found then
  if v_prior.requested_allocations<>p_allocations then
   raise exception '相同操作代碼不得搭配不同抵扣內容' using errcode='23505';
  end if;
  return jsonb_build_object('status','confirmed','operation_id',v_prior.id,
   'credit_id',p_credit_id,'applied_cents',v_prior.amount_cents,
   'idempotent',true,'currency','TWD');
 end if;
 select tutor_private.v56_credit_available(p_credit_id) into v_balance;
 for v_row in select a.lesson_id,a.amount_cents
  from jsonb_to_recordset(p_allocations) as a(lesson_id uuid,amount_cents bigint)
  order by a.lesson_id
 loop
  if v_row.lesson_id is null or v_row.amount_cents is null
   or v_row.amount_cents<=0 or v_row.lesson_id=any(v_seen) then
   raise exception '不可分配零元、負數或重複課程' using errcode='23514';
  end if;
  v_seen:=array_append(v_seen,v_row.lesson_id);
  select * into v_fee from tutor_private.v5_team_lesson_fees
   where lesson_id=v_row.lesson_id for update;
  if not found or v_fee.team_id<>v_credit.team_id
   or v_fee.student_id<>v_credit.student_id then
   raise exception '只能抵扣同 Team 同學生的應收' using errcode='42501';
  end if;
  select tutor_private.v56_direct_net_for_lesson(v_fee.lesson_id)+tutor_private.v56_advance_net_for_lesson(v_fee.lesson_id) into v_paid;
  if v_paid+v_row.amount_cents>v_fee.amount_cents
   or v_total>v_balance-v_row.amount_cents then
   raise exception '預收餘額不足或課程已結清' using errcode='23514';
  end if;
  v_total:=v_total+v_row.amount_cents;
  v_details:=v_details||jsonb_build_array(jsonb_build_object(
   'lesson_id',v_fee.lesson_id,'subject',v_fee.subject,
   'amount_cents',v_row.amount_cents));
 end loop;
 insert into tutor_private.v5_team_advance_operations(
  credit_id,idempotency_key,requested_allocations,amount_cents,confirmed_by)
 values(p_credit_id,p_idempotency_key,p_allocations,v_total,v_actor)
 returning id into v_op;
 for v_row in select a.lesson_id,a.amount_cents
  from jsonb_to_recordset(p_allocations) as a(lesson_id uuid,amount_cents bigint)
  order by a.lesson_id
 loop
  insert into tutor_private.v5_team_advance_applications(
   operation_id,credit_id,lesson_id,amount_cents)
  values(v_op,p_credit_id,v_row.lesson_id,v_row.amount_cents);
 end loop;
 insert into tutor_private.v5_team_advance_audit(
  team_id,student_id,payment_id,credit_id,operation_id,
  actor_id,event,amount_cents,details)
 values(v_credit.team_id,v_credit.student_id,v_credit.payment_id,
  p_credit_id,v_op,v_actor,'credit_applied',v_total,v_details);
 return jsonb_build_object('status','confirmed','operation_id',v_op,
  'credit_id',p_credit_id,'applied_cents',v_total,'idempotent',false,
  'currency','TWD','allocations',v_details);
end;$$;

create or replace function public.v5_team_advance_overview(
 p_team_id uuid,p_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_credits jsonb;
 v_receivables jsonb;
 v_suggestions jsonb;
 v_balance bigint;
 v_due bigint;
begin
 select t.anchor_workspace_id into v_anchor
  from public.v5_teams t where t.id=p_team_id;
 if v_actor is null or v_anchor is null or p_student_id is null
  or not exists(select 1 from public.v5_team_students s
    where s.team_id=p_team_id and s.id=p_student_id)
  or not exists(select 1 from public.v5_team_governance g
    join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
    where g.workspace_id=v_anchor and g.manager_user_id=v_actor
     and e.plan_code='team') then
  raise exception '無權查詢此學生預收款' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'credit_id',c.id,'payment_id',c.payment_id,'amount_cents',c.amount_cents,
  'used_cents',tutor_private.v56_credit_net_applied(c.id),
  'refund_reserved_cents',tutor_private.v56_credit_total_reserved(c.id),
  'available_cents',tutor_private.v56_credit_available(c.id),
  'created_at',c.created_at) order by c.created_at,c.id),'[]'::jsonb),
  coalesce(sum(tutor_private.v56_credit_available(c.id)),0)::bigint
 into v_credits,v_balance
 from tutor_private.v5_team_advance_credits c
 left join lateral(select sum(x.amount_cents)::bigint used
  from tutor_private.v5_team_advance_applications x
  where x.credit_id=c.id) a on true
 left join lateral(
  select sum(q.amount_cents)::bigint reserved
  from tutor_private.v56_team_credit_refund_requests q
  where q.credit_id=c.id and exists(
   select 1 from tutor_private.v56_team_credit_refund_events e
   where e.request_id=q.id and e.event='approved')
 ) r on true
 where c.team_id=p_team_id and c.student_id=p_student_id;
 with due as (
  select f.lesson_id,f.subject,f.lesson_start,f.amount_cents,
   f.amount_cents-tutor_private.v56_direct_net_for_lesson(f.lesson_id)-tutor_private.v56_advance_net_for_lesson(f.lesson_id) as outstanding
  from tutor_private.v5_team_lesson_fees f
  left join lateral(select sum(x.amount_cents)::bigint paid
   from tutor_private.v5_team_payment_allocations x
   where x.lesson_id=f.lesson_id) d on true
  left join lateral(select sum(x.amount_cents)::bigint applied
   from tutor_private.v5_team_advance_applications x
   where x.lesson_id=f.lesson_id) a on true
  where f.team_id=p_team_id and f.student_id=p_student_id
 ), numbered as (
  select *,coalesce(sum(outstanding) over (
   order by lesson_start,lesson_id rows between unbounded preceding
   and 1 preceding),0)::bigint as preceding_due
  from due
 )
 select
  coalesce(jsonb_agg(jsonb_build_object(
   'lesson_id',lesson_id,'subject',subject,'lesson_start',lesson_start,
   'amount_cents',amount_cents,'outstanding_cents',outstanding)
   order by lesson_start,lesson_id),'[]'::jsonb),
  coalesce(sum(outstanding),0)::bigint,
  coalesce(jsonb_agg(jsonb_build_object(
   'lesson_id',lesson_id,'subject',subject,
   'suggested_cents',least(outstanding,greatest(v_balance-preceding_due,0)))
   order by lesson_start,lesson_id)
   filter(where outstanding>0 and v_balance>preceding_due),'[]'::jsonb)
 into v_receivables,v_due,v_suggestions
 from numbered;
 return jsonb_build_object('team_id',p_team_id,'student_id',p_student_id,
  'currency','TWD','credits',v_credits,'available_cents',v_balance,
  'receivables',v_receivables,'outstanding_cents',v_due,
  'suggestions',v_suggestions);
end;$$;

create or replace function public.v5_team_payment_overview(
 p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_from timestamptz;
 v_until timestamptz;
 v_lesson_rows jsonb;
 v_payment_rows jsonb;
 v_confirmed bigint;
 v_outstanding bigint;
 v_direct bigint;
 v_advance_applied bigint;
 v_advance_created bigint;
 v_advance_available bigint;
 v_refund_reserved bigint;
 v_manual_refund_paid bigint;
begin
 if v_actor is null or p_team_id is null or p_month is null
  or p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception '查詢月份無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
  from public.v5_teams t where t.id=p_team_id;
 if v_anchor is null or not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team'
 ) then
  raise exception '只有現任 Team 管理者可以查詢付款'
   using errcode='42501';
 end if;
 v_from:=p_month::timestamp at time zone 'Asia/Taipei';
 v_until:=(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 -- Count each course only once. Independently aggregate its direct payments
 -- and advance applications so two one-to-many relations never multiply sums.
 select coalesce(jsonb_agg(jsonb_build_object(
   'lesson_id',f.lesson_id,'student_id',f.student_id,
   'student_name',s.display_name,'subject',f.subject,
   'project_id',f.project_id,'teacher_user_id',f.teacher_user_id,
   'lesson_start',f.lesson_start,'amount_cents',f.amount_cents,
   'direct_allocated_cents',tutor_private.v56_direct_net_for_lesson(f.lesson_id),
   'advance_applied_cents',tutor_private.v56_advance_net_for_lesson(f.lesson_id),
   'allocated_cents',tutor_private.v56_direct_net_for_lesson(f.lesson_id)+tutor_private.v56_advance_net_for_lesson(f.lesson_id),
   'outstanding_cents',f.amount_cents-tutor_private.v56_direct_net_for_lesson(f.lesson_id)-tutor_private.v56_advance_net_for_lesson(f.lesson_id)
  ) order by f.lesson_start,f.lesson_id),'[]'::jsonb),
  coalesce(sum(f.amount_cents-tutor_private.v56_direct_net_for_lesson(f.lesson_id)-tutor_private.v56_advance_net_for_lesson(f.lesson_id)),0)::bigint,
  coalesce(sum(tutor_private.v56_direct_net_for_lesson(f.lesson_id)),0)::bigint,
  coalesce(sum(tutor_private.v56_advance_net_for_lesson(f.lesson_id)),0)::bigint
 into v_lesson_rows,v_outstanding,v_direct,v_advance_applied
 from tutor_private.v5_team_lesson_fees f
 join public.v5_team_students s on s.id=f.student_id
 left join lateral(
  select sum(x.amount_cents)::bigint cents
   from tutor_private.v5_team_payment_allocations x
   where x.lesson_id=f.lesson_id
 ) d on true
 left join lateral(
  select sum(x.amount_cents)::bigint cents
   from tutor_private.v5_team_advance_applications x
   where x.lesson_id=f.lesson_id
 ) a on true
 where f.team_id=p_team_id and f.lesson_start>=v_from and f.lesson_start<v_until;

 -- Payment received_on controls its month; a future advance offset does not
 -- create another confirmed payment. The credit rows are one-to-one per payment.
 select coalesce(jsonb_agg(jsonb_build_object(
   'payment_id',p.id,'student_id',p.student_id,
   'student_name',s.display_name,'amount_cents',p.amount_cents,
   'received_on',p.received_on,'method',p.method,'reference',p.reference,
   'note',p.note,'status',
    case when exists(select 1 from tutor_private.v56_team_pending_payment_voids v
     where v.payment_id=p.id) then 'void' else p.status end,'reported_at',p.reported_at,
   'confirmed_at',p.confirmed_at,
   'intended_advance_cents',coalesce(i.expected_credit_cents,0),
   'advance_credit_id',c.id,
   'advance_credit_cents',coalesce(c.amount_cents,0),
   'allocations',coalesce(d.details,'[]'::jsonb)
  ) order by p.received_on,p.id),'[]'::jsonb),
  coalesce(sum(p.amount_cents) filter(where p.status='confirmed'),0)::bigint,
  coalesce(sum(coalesce(c.amount_cents,0))
   filter(where p.status='confirmed'),0)::bigint
 into v_payment_rows,v_confirmed,v_advance_created
 from tutor_private.v5_team_payment_reports p
 join public.v5_team_students s on s.id=p.student_id
 left join tutor_private.v5_team_advance_intents i on i.payment_id=p.id
 left join tutor_private.v5_team_advance_credits c on c.payment_id=p.id
 left join lateral(
  select jsonb_agg(jsonb_build_object(
   'lesson_id',x.lesson_id,'amount_cents',x.amount_cents,
   'reversed_cents',coalesce((select sum(r.amount_cents) from tutor_private.v56_team_direct_refund_reversals r where r.payment_id=x.payment_id and r.lesson_id=x.lesson_id),0),
   'net_amount_cents',x.amount_cents-coalesce((select sum(r.amount_cents) from tutor_private.v56_team_direct_refund_reversals r where r.payment_id=x.payment_id and r.lesson_id=x.lesson_id),0),
   'subject',f.subject) order by x.lesson_id) details
  from tutor_private.v5_team_payment_allocations x
  join tutor_private.v5_team_lesson_fees f on f.lesson_id=x.lesson_id
  where x.payment_id=p.id
 ) d on true
 where p.team_id=p_team_id and p.received_on>=p_month
  and p.received_on<(p_month+interval '1 month')::date;

 -- This is an all-time balance (not a month-only balance). Every credit is
 -- counted exactly once and its applications are never added to receipts.
 select coalesce(sum(tutor_private.v56_credit_available(c.id)),0)::bigint
 into v_advance_available
 from tutor_private.v5_team_advance_credits c
 left join lateral(
  select sum(x.amount_cents)::bigint used_cents
  from tutor_private.v5_team_advance_applications x
  where x.credit_id=c.id
 ) ap on true
 left join lateral(
  select sum(q.amount_cents)::bigint reserved_cents
  from tutor_private.v56_team_credit_refund_requests q
  where q.credit_id=c.id and exists(
   select 1 from tutor_private.v56_team_credit_refund_events e
   where e.request_id=q.id and e.event='approved')
 ) r on true
 where c.team_id=p_team_id;
 select coalesce(sum(q.amount_cents),0)::bigint into v_refund_reserved
 from tutor_private.v56_team_credit_refund_requests q
 where q.team_id=p_team_id and exists(
  select 1 from tutor_private.v56_team_credit_refund_events e
  where e.request_id=q.id and e.event='approved');
 select coalesce(sum(q.amount_cents),0)::bigint into v_manual_refund_paid
 from tutor_private.v56_team_credit_refund_requests q
 join tutor_private.v56_team_credit_refund_events e on e.request_id=q.id
 where q.team_id=p_team_id and e.event='manual_paid'
  and e.recorded_on>=p_month and e.recorded_on<(p_month+interval '1 month')::date;

 return jsonb_build_object(
  'team_id',p_team_id,'month',p_month,'currency','TWD',
  'receivables',v_lesson_rows,'payments',v_payment_rows,
  'outstanding_cents',v_outstanding,
  'direct_allocated_cents',v_direct,
  'advance_applied_cents',v_advance_applied,
  'confirmed_payments_cents',v_confirmed,
  'advance_created_cents',v_advance_created,
  'advance_available_cents',v_advance_available,
  'refund_reserved_cents',v_refund_reserved,
  'manual_paid_refunds_cents',v_manual_refund_paid,
  'net_cash_movement_cents',v_confirmed-v_manual_refund_paid);
end;$$;
revoke all on function public.v5_report_team_payment(uuid,uuid,bigint,date,text,text,text) from public,anon,authenticated;
grant execute on function public.v5_report_team_payment(uuid,uuid,bigint,date,text,text,text) to authenticated;
revoke all on function public.v5_report_team_payment_with_advance(uuid,uuid,bigint,date,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.v5_report_team_payment_with_advance(uuid,uuid,bigint,date,text,text,bigint,text) to authenticated;
revoke all on function public.v5_confirm_team_payment_allocation(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.v5_confirm_team_payment_allocation(uuid,jsonb) to authenticated;
revoke all on function public.v5_confirm_team_advance_payment(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.v5_confirm_team_advance_payment(uuid,jsonb) to authenticated;
revoke all on function public.v5_apply_team_advance_credit(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.v5_apply_team_advance_credit(uuid,jsonb,text) to authenticated;
revoke all on function public.v5_team_advance_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.v5_team_advance_overview(uuid,uuid) to authenticated;
revoke all on function public.v5_team_payment_overview(uuid,date) from public,anon,authenticated;
grant execute on function public.v5_team_payment_overview(uuid,date) to authenticated;
revoke all on function tutor_private.v5_guard_combined_lesson_settlement() from public,anon,authenticated;
