-- V5.6 P0/P1: refund source picker and corrected net credit capacity.
-- Additive forward migration; DISPOSABLE CI ONLY.
create or replace function public.v56_request_team_credit_refund(
 p_credit_id uuid,p_amount_cents bigint,p_idempotency_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_credit tutor_private.v5_team_advance_credits%rowtype;
 v_old tutor_private.v56_team_credit_refund_requests%rowtype;
 v_available bigint;
 v_id uuid;
begin
 if v_actor is null or p_credit_id is null or p_amount_cents is null
  or p_amount_cents not between 1 and 1000000000
  or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '退款申請資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_advance_credits c join public.v5_teams t
  on t.id=c.team_id where c.id=p_credit_id;
 if v_anchor is null then raise exception '預收款不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可申請退款' using errcode='42501';
 end if;
 select * into v_credit from tutor_private.v5_team_advance_credits
  where id=p_credit_id for update;
 select * into v_old from tutor_private.v56_team_credit_refund_requests
  where credit_id=p_credit_id and idempotency_key=p_idempotency_key;
 if found then
  if v_old.amount_cents<>p_amount_cents or v_old.reason<>p_reason then
   raise exception '退款操作代碼不得搭配不同內容' using errcode='23505';
  end if;
  return jsonb_build_object('request_id',v_old.id,'idempotent',true,
   'status','requested','currency','TWD');
 end if;
 select tutor_private.v56_credit_available(p_credit_id) into v_available;
 if p_amount_cents>v_available then
  raise exception '退款額度超過尚未抵扣或預留的預收款' using errcode='23514';
 end if;
 insert into tutor_private.v56_team_credit_refund_requests(
  credit_id,payment_id,team_id,student_id,amount_cents,reason,idempotency_key,actor_id)
 values(v_credit.id,v_credit.payment_id,v_credit.team_id,v_credit.student_id,
  p_amount_cents,p_reason,p_idempotency_key,v_actor)
 returning id into v_id;
 return jsonb_build_object('request_id',v_id,'status','requested',
  'idempotent',false,'amount_cents',p_amount_cents,'currency','TWD');
end;$$;
create or replace function public.v56_decide_team_credit_refund(
 p_request_id uuid,p_approve boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_req tutor_private.v56_team_credit_refund_requests%rowtype;
 v_event tutor_private.v56_team_credit_refund_events%rowtype;
 v_available bigint;
 v_kind text;
begin
 if v_actor is null or p_request_id is null or p_approve is null
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '退款審核資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v56_team_credit_refund_requests r
 join public.v5_teams t on t.id=r.team_id where r.id=p_request_id;
 if v_anchor is null then raise exception '退款申請不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可審核退款' using errcode='42501';
 end if;
 select * into v_req from tutor_private.v56_team_credit_refund_requests
  where id=p_request_id for update;
 v_kind:=case when p_approve then 'approved' else 'rejected' end;
 select * into v_event from tutor_private.v56_team_credit_refund_events
  where request_id=p_request_id and event in ('approved','rejected');
 if found then
  if v_event.event<>v_kind then
   raise exception '退款申請已被決定，不可反向覆寫' using errcode='23505';
  end if;
  return jsonb_build_object('request_id',p_request_id,'status',v_kind,
   'idempotent',true);
 end if;
 if p_approve then
  perform 1 from tutor_private.v5_team_advance_credits c where c.id=v_req.credit_id for update;
  select tutor_private.v56_credit_available(v_req.credit_id) into v_available;
  if v_available<v_req.amount_cents then
   raise exception '預收餘額不足，不可核准退款' using errcode='23514';
  end if;
 end if;
 insert into tutor_private.v56_team_credit_refund_events(
  request_id,event,reason,actor_id)
 values(p_request_id,v_kind,p_reason,v_actor);
 return jsonb_build_object('request_id',p_request_id,
  'status',v_kind,'idempotent',false,'amount_cents',v_req.amount_cents,
  'currency','TWD');
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
 -- Add reserved refunds of previously applied credit, avoiding double count.
 select v_refund_reserved+coalesce(sum(r.amount_cents),0)::bigint into v_refund_reserved
 from tutor_private.v56_team_advance_application_reversals r
 where r.team_id=p_team_id and r.refund_reserved;
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

create function public.v56_team_refundable_allocations(
 p_team_id uuid,p_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());v_anchor uuid;v_direct jsonb;v_advance jsonb;
begin
 if v_actor is null or p_team_id is null or p_student_id is null
 then raise exception '查詢參數無效' using errcode='22023'; end if;
 select anchor_workspace_id into v_anchor from public.v5_teams where id=p_team_id;
 if v_anchor is null or not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 or not exists(select 1 from public.v5_team_students s where s.id=p_student_id and s.team_id=p_team_id)
 then raise exception '僅現任 Team 管理者可查看待調整的課程分配' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'payment_id',a.payment_id,'lesson_id',a.lesson_id,
  'subject',f.subject,'original_cents',a.amount_cents,
  'reversed_cents',coalesce(r.used,0),
  'remaining_cents',a.amount_cents-coalesce(r.used,0))
  order by f.lesson_start,a.lesson_id,a.payment_id),'[]'::jsonb)
 into v_direct from tutor_private.v5_team_payment_allocations a
 join tutor_private.v5_team_payment_reports p on p.id=a.payment_id and p.status='confirmed'
 join tutor_private.v5_team_lesson_fees f on f.lesson_id=a.lesson_id
 left join lateral(select sum(x.amount_cents)::bigint used
  from tutor_private.v56_team_direct_refund_reversals x
  where x.payment_id=a.payment_id and x.lesson_id=a.lesson_id) r on true
 where p.team_id=p_team_id and p.student_id=p_student_id
  and f.team_id=p_team_id and f.student_id=p_student_id;
 select coalesce(jsonb_agg(jsonb_build_object(
  'credit_id',a.credit_id,'operation_id',a.operation_id,'lesson_id',a.lesson_id,
  'subject',f.subject,'original_cents',a.amount_cents,
  'reversed_cents',coalesce(r.used,0),
  'remaining_cents',a.amount_cents-coalesce(r.used,0))
  order by f.lesson_start,a.lesson_id,a.operation_id),'[]'::jsonb)
 into v_advance from tutor_private.v5_team_advance_applications a
 join tutor_private.v5_team_advance_credits c on c.id=a.credit_id
 join tutor_private.v5_team_lesson_fees f on f.lesson_id=a.lesson_id
 left join lateral(select sum(x.amount_cents)::bigint used
  from tutor_private.v56_team_advance_application_reversals x
  where x.operation_id=a.operation_id and x.lesson_id=a.lesson_id) r on true
 where c.team_id=p_team_id and c.student_id=p_student_id
 and f.team_id=p_team_id and f.student_id=p_student_id;
 return jsonb_build_object('team_id',p_team_id,'student_id',p_student_id,
 'currency','TWD','direct_allocations',v_direct,'advance_applications',v_advance,
 'bank_verified',false);
end;$$;
revoke all on function public.v56_team_refundable_allocations(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.v56_team_refundable_allocations(uuid,uuid) to authenticated;

revoke all on function public.v56_request_team_credit_refund(uuid,bigint,text,text),
 public.v56_decide_team_credit_refund(uuid,boolean,text),public.v5_team_payment_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_request_team_credit_refund(uuid,bigint,text,text),
 public.v56_decide_team_credit_refund(uuid,boolean,text),public.v5_team_payment_overview(uuid,date)
 to authenticated;
