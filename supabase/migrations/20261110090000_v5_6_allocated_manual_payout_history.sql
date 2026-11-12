-- V5.6 P1 manual payout declaration only, NO bank verification. DISPOSABLE CI.

create table tutor_private.v56_team_allocated_refund_manual_payouts(
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('direct','applied_credit')),
 request_id uuid not null,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 manual_reference text not null check(char_length(manual_reference) between 8 and 80),
 paid_on date not null,
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 actor_id uuid not null references auth.users(id),
 declared_at timestamptz not null default now(),
 unique(source,request_id),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
alter table tutor_private.v56_team_allocated_refund_manual_payouts enable row level security;
revoke all on tutor_private.v56_team_allocated_refund_manual_payouts from public,anon,authenticated;
create trigger v56_allocated_payouts_immutable before update or delete
 on tutor_private.v56_team_allocated_refund_manual_payouts for each row
 execute function tutor_private.v56_reject_financial_history_mutation();

create function public.v56_record_allocated_refund_manual_paid(
 p_source text,p_request_id uuid,p_reference text,p_paid_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());v_anchor uuid;v_team uuid;v_student uuid;v_amount bigint;
 v_prior tutor_private.v56_team_allocated_refund_manual_payouts%rowtype;
begin
 if v_actor is null or p_request_id is null or p_source not in ('direct','applied_credit')
  or p_source is null or p_reference is null or char_length(p_reference) not between 8 and 80
  or p_paid_on is null or p_paid_on>(now() at time zone 'Asia/Taipei')::date
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250
 then raise exception '人工退款聲明資料不正確' using errcode='22023'; end if;
 if p_source='direct' then
  select q.team_id,q.student_id,q.amount_cents into v_team,v_student,v_amount
  from tutor_private.v56_team_direct_refund_intake q
  join tutor_private.v56_team_direct_refund_decisions d
   on d.request_id=q.id and d.approved
  where q.id=p_request_id;
 else
  select q.team_id,q.student_id,q.amount_cents into v_team,v_student,v_amount
  from tutor_private.v56_team_applied_credit_requests q
  join tutor_private.v56_team_applied_credit_decisions d
   on d.request_id=q.id and d.approved
  where q.id=p_request_id and q.mode='refund_reserved';
 end if;
 if v_team is null then raise exception '必須先核准指定的退款' using errcode='23514'; end if;
 select t.anchor_workspace_id into v_anchor from public.v5_teams t where t.id=v_team;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 then raise exception '僅現任 Team 管理者可聲明人工退款' using errcode='42501'; end if;
 select * into v_prior from tutor_private.v56_team_allocated_refund_manual_payouts
  where source=p_source and request_id=p_request_id;
 if found then
  if v_prior.manual_reference<>p_reference or v_prior.paid_on<>p_paid_on
   or v_prior.reason<>p_reason then raise exception '退款聲明不可改寫' using errcode='23505'; end if;
  return jsonb_build_object('request_id',p_request_id,'status','manual_paid_not_bank_verified',
   'amount_cents',v_amount,'idempotent',true,'bank_verified',false);
 end if;
 insert into tutor_private.v56_team_allocated_refund_manual_payouts(
  source,request_id,team_id,student_id,amount_cents,manual_reference,paid_on,reason,actor_id)
 values(p_source,p_request_id,v_team,v_student,v_amount,p_reference,p_paid_on,p_reason,v_actor);
 return jsonb_build_object('request_id',p_request_id,'status','manual_paid_not_bank_verified',
  'amount_cents',v_amount,'idempotent',false,'bank_verified',false);
end;$$;
revoke all on function public.v56_record_allocated_refund_manual_paid(text,uuid,text,date,text)
 from public,anon,authenticated;
grant execute on function public.v56_record_allocated_refund_manual_paid(text,uuid,text,date,text)
 to authenticated;


create or replace function public.v56_team_direct_refund_intake_overview(
 p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_rows jsonb;
begin
 if v_actor is null or p_team_id is null or p_month is null
  or p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception '查詢月份無效' using errcode='22023';
 end if;
 select anchor_workspace_id into v_anchor from public.v5_teams where id=p_team_id;
 if v_anchor is null or not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team'
 ) then
  raise exception '僅現任 Team 管理者可查看退款申請' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'request_id',r.id,'payment_id',r.payment_id,'student_id',r.student_id,
  'amount_cents',r.amount_cents,'allocations',r.allocations,
  'requested_at',r.requested_at,'status',case
   when exists(select 1 from tutor_private.v56_team_allocated_refund_manual_payouts m
    where m.source='direct' and m.request_id=r.id) then 'manual_paid_not_bank_verified'
   when exists(select 1 from tutor_private.v56_team_direct_refund_decisions d
    where d.request_id=r.id and d.approved) then 'approved_reversed_pending_manual_payout'
   when exists(select 1 from tutor_private.v56_team_direct_refund_decisions d
    where d.request_id=r.id and not d.approved) then 'rejected'
   else 'requested_no_settlement' end,
  'settlement_changed',exists(select 1 from tutor_private.v56_team_direct_refund_decisions d where d.request_id=r.id and d.approved),'bank_verified',false)
  order by r.requested_at,r.id),'[]'::jsonb)
 into v_rows from tutor_private.v56_team_direct_refund_intake r
 where r.team_id=p_team_id
  and r.requested_at>=p_month::timestamp at time zone 'Asia/Taipei'
  and r.requested_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 return jsonb_build_object('team_id',p_team_id,'month',p_month,'currency','TWD',
  'requests',v_rows,'settlement_changed',false,'bank_verified',false);
end;$$;
create or replace function public.v56_team_applied_credit_adjustment_overview(p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());v_anchor uuid;v_rows jsonb;
begin
 if v_actor is null or p_team_id is null or p_month is null
  or p_month<>date_trunc('month',p_month::timestamp)::date
 then raise exception '查詢參數無效' using errcode='22023'; end if;
 select anchor_workspace_id into v_anchor from public.v5_teams where id=p_team_id;
 if v_anchor is null or not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 then raise exception '無權查看預收抵扣調整' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('request_id',q.id,
  'credit_id',q.credit_id,'student_id',q.student_id,'amount_cents',q.amount_cents,
  'mode',q.mode,'entries',q.entries,'requested_at',q.requested_at,
  'status',case when exists(select 1 from tutor_private.v56_team_allocated_refund_manual_payouts m where m.source='applied_credit' and m.request_id=q.id) then 'manual_paid_not_bank_verified' when d.request_id is null then 'requested'
   when d.approved then case when q.mode='refund_reserved' then 'approved_refund_reserved'
   else 'approved_restored_credit' end else 'rejected' end,
  'bank_verified',false,'manual_paid',false) order by q.requested_at,q.id),'[]'::jsonb)
 into v_rows from tutor_private.v56_team_applied_credit_requests q
 left join tutor_private.v56_team_applied_credit_decisions d on d.request_id=q.id
 where q.team_id=p_team_id
 and q.requested_at>=p_month::timestamp at time zone 'Asia/Taipei'
 and q.requested_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 return jsonb_build_object('team_id',p_team_id,'month',p_month,'currency','TWD',
  'requests',v_rows,'bank_verified',false);
end;$$;
create or replace function public.v56_team_conservation_overview(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_due bigint;
 v_fees bigint;
 v_direct bigint;
 v_advance bigint;
 v_credit_created bigint;
 v_credit_available bigint;
 v_credit_reserved bigint;
 v_credit_applied bigint;
 v_confirmed_cash bigint;
 v_direct_liability bigint;
 v_applied_refund_liability bigint;
 v_unused_refund_liability bigint;
 v_credit_manual_paid bigint;
 v_allocated_manual_paid bigint;
begin
 if v_actor is null or p_team_id is null then
  raise exception '缺少 Team' using errcode='22023'; end if;
 select anchor_workspace_id into v_anchor from public.v5_teams where id=p_team_id;
 if v_anchor is null or not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 then raise exception '僅現任 Team 管理者可查看完整帳務守恆' using errcode='42501'; end if;
 select coalesce(sum(f.amount_cents),0)::bigint,
  coalesce(sum(tutor_private.v56_direct_net_for_lesson(f.lesson_id)),0)::bigint,
  coalesce(sum(tutor_private.v56_advance_net_for_lesson(f.lesson_id)),0)::bigint
 into v_fees,v_direct,v_advance
 from tutor_private.v5_team_lesson_fees f where f.team_id=p_team_id;
 v_due:=v_fees-v_direct-v_advance;
 select coalesce(sum(c.amount_cents),0)::bigint,
  coalesce(sum(tutor_private.v56_credit_available(c.id)),0)::bigint,
  coalesce(sum(tutor_private.v56_credit_total_reserved(c.id)),0)::bigint,
  coalesce(sum(tutor_private.v56_credit_net_applied(c.id)),0)::bigint
 into v_credit_created,v_credit_available,v_credit_reserved,v_credit_applied
 from tutor_private.v5_team_advance_credits c where c.team_id=p_team_id;
 select coalesce(sum(p.amount_cents),0)::bigint into v_confirmed_cash
 from tutor_private.v5_team_payment_reports p
 where p.team_id=p_team_id and p.status='confirmed';
 select coalesce(sum(d.amount_cents),0)::bigint into v_direct_liability
 from tutor_private.v56_team_direct_refund_decisions d
 where d.team_id=p_team_id and d.approved;
 select coalesce(sum(r.amount_cents),0)::bigint into v_applied_refund_liability
 from tutor_private.v56_team_advance_application_reversals r
 where r.team_id=p_team_id and r.refund_reserved;
 select coalesce(sum(q.amount_cents),0)::bigint into v_unused_refund_liability
 from tutor_private.v56_team_credit_refund_requests q
 where q.team_id=p_team_id and exists(select 1 from tutor_private.v56_team_credit_refund_events e
  where e.request_id=q.id and e.event='approved');
 select coalesce(sum(q.amount_cents),0)::bigint into v_credit_manual_paid
 from tutor_private.v56_team_credit_refund_requests q
 where q.team_id=p_team_id and exists(select 1 from tutor_private.v56_team_credit_refund_events e
  where e.request_id=q.id and e.event='manual_paid');
 select coalesce(sum(m.amount_cents),0)::bigint into v_allocated_manual_paid
 from tutor_private.v56_team_allocated_refund_manual_payouts m
 where m.team_id=p_team_id;
 if v_due<0 or v_direct<0 or v_advance<0 or v_credit_available<0
  or v_credit_created<>v_credit_available+v_credit_applied+v_credit_reserved
  or exists(select 1 from tutor_private.v5_team_lesson_fees f
   where f.team_id=p_team_id and
   (tutor_private.v56_direct_net_for_lesson(f.lesson_id)<0 or
    tutor_private.v56_advance_net_for_lesson(f.lesson_id)<0 or
    f.amount_cents<tutor_private.v56_direct_net_for_lesson(f.lesson_id)+
     tutor_private.v56_advance_net_for_lesson(f.lesson_id)))
 then raise exception 'Team 淨帳務守恆檢查失敗' using errcode='23514'; end if;
 return jsonb_build_object('team_id',p_team_id,'currency','TWD',
  'receivable_cents',v_fees,'direct_net_cents',v_direct,
  'advance_net_cents',v_advance,'outstanding_cents',v_due,
  'confirmed_cash_book_cents',v_confirmed_cash,
  'advance_created_cents',v_credit_created,'advance_applied_net_cents',v_credit_applied,
  'advance_available_cents',v_credit_available,'advance_reserved_cents',v_credit_reserved,
  'direct_refund_liability_cents',v_direct_liability,
  'applied_credit_refund_liability_cents',v_applied_refund_liability,
  'unused_credit_refund_liability_cents',v_unused_refund_liability,
  'unused_credit_manual_paid_cents',v_credit_manual_paid,
  'allocated_manual_paid_refunds_cents',v_allocated_manual_paid,
  'cash_book_net_after_declared_refunds_cents',v_confirmed_cash-v_credit_manual_paid-v_allocated_manual_paid,
  'cash_book_net_after_declared_unused_refunds_cents',v_confirmed_cash-v_credit_manual_paid,
  'bank_verified',false,'conservation_passed',true);
end;$$;
create or replace function public.v56_team_parent_finance_overview(
 p_team_id uuid,p_team_student_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_rows jsonb;
 v_payments jsonb;
 v_refunds jsonb;
begin
 if v_actor is null or p_team_id is null or p_team_student_id is null
  or p_month is null or p_month<>date_trunc('month',p_month::timestamp)::date
 then raise exception '家長查詢參數無效' using errcode='22023'; end if;
 if not exists(
  select 1 from tutor_private.v56_team_family_bridge_proposals p
  join tutor_private.v56_team_family_bridge_acceptances a
   on a.proposal_id=p.id and a.guardian_id=v_actor
  join public.v5_teams t on t.id=p.team_id
  join public.v5_workspace_entitlements e on e.workspace_id=t.anchor_workspace_id
  where p.team_id=p_team_id and p.team_student_id=p_team_student_id
   and e.plan_code='team'
   and not exists(select 1 from tutor_private.v56_team_family_bridge_revocations x
    where x.proposal_id=p.id and x.guardian_id=v_actor)
   and exists(select 1 from public.student_guardians sg
    where sg.student_id=p.v4_student_id and sg.teacher_id=p.v4_teacher_id
     and sg.guardian_id=v_actor)
   and exists(select 1 from public.students vs
    where vs.id=p.v4_student_id and vs.teacher_id=p.v4_teacher_id)
 ) then raise exception '家長對此 Team 學生沒有有效連結' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'lesson_id',f.lesson_id,'subject',f.subject,'lesson_start',f.lesson_start,
  'fee_cents',f.amount_cents,
  'direct_paid_net_cents',tutor_private.v56_direct_net_for_lesson(f.lesson_id),
  'advance_paid_net_cents',tutor_private.v56_advance_net_for_lesson(f.lesson_id),
  'outstanding_cents',f.amount_cents-
   tutor_private.v56_direct_net_for_lesson(f.lesson_id)-
   tutor_private.v56_advance_net_for_lesson(f.lesson_id))
  order by f.lesson_start,f.lesson_id),'[]'::jsonb)
 into v_rows from tutor_private.v5_team_lesson_fees f
 where f.team_id=p_team_id and f.student_id=p_team_student_id
  and f.lesson_start>=p_month::timestamp at time zone 'Asia/Taipei'
  and f.lesson_start<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 select coalesce(jsonb_agg(jsonb_build_object(
  'received_on',p.received_on,'amount_cents',p.amount_cents,
  'status',p.status,'method',p.method)
  order by p.received_on,p.id),'[]'::jsonb) into v_payments
 from tutor_private.v5_team_payment_reports p
 where p.team_id=p_team_id and p.student_id=p_team_student_id and p.status='confirmed'
  and p.received_on>=p_month and p.received_on<(p_month+interval '1 month')::date;
 with history as (
  select 'direct_refund'::text kind,r.requested_at as event_at,r.amount_cents,
   case when d.request_id is null then 'requested'
    when exists(select 1 from tutor_private.v56_team_allocated_refund_manual_payouts m
     where m.source='direct' and m.request_id=r.id) then 'manual_paid_not_bank_verified'
    when d.approved then 'approved_reversed_pending_manual_payout' else 'rejected' end status
  from tutor_private.v56_team_direct_refund_intake r
  left join tutor_private.v56_team_direct_refund_decisions d on d.request_id=r.id
  where r.team_id=p_team_id and r.student_id=p_team_student_id
  union all
  select 'unused_credit_refund',q.requested_at,q.amount_cents,
   case when exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=q.id and e.event='manual_paid') then 'manual_paid_not_bank_verified'
   when exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=q.id and e.event='approved') then 'approved_reserved'
   when exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=q.id and e.event='rejected') then 'rejected' else 'requested' end
  from tutor_private.v56_team_credit_refund_requests q
  where q.team_id=p_team_id and q.student_id=p_team_student_id
  union all
  select 'applied_credit_adjustment',q.requested_at,q.amount_cents,
   case when d.request_id is null then 'requested'
    when not d.approved then 'rejected'
    when exists(select 1 from tutor_private.v56_team_allocated_refund_manual_payouts m
     where m.source='applied_credit' and m.request_id=q.id) then 'manual_paid_not_bank_verified'
    when q.mode='refund_reserved' then 'approved_refund_reserved'
    else 'approved_restored_credit' end
  from tutor_private.v56_team_applied_credit_requests q
  left join tutor_private.v56_team_applied_credit_decisions d on d.request_id=q.id
  where q.team_id=p_team_id and q.student_id=p_team_student_id
  union all
  select 'payment_metadata_correction',c.recorded_at,0::bigint,'recorded'
  from tutor_private.v56_team_payment_corrections c
  where c.team_id=p_team_id and c.student_id=p_team_student_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'type',kind,'event_at',event_at,'amount_cents',amount_cents,'status',status)
  order by event_at,kind),'[]'::jsonb)
 into v_refunds from history
 where event_at>=p_month::timestamp at time zone 'Asia/Taipei'
  and event_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 return jsonb_build_object('team_id',p_team_id,'student_id',p_team_student_id,
  'month',p_month,'currency','TWD','receivables',v_rows,
  'payments',v_payments,'correction_refund_history',v_refunds,
  'bank_verified',false);
end;$$;
revoke all on function public.v56_team_direct_refund_intake_overview(uuid,date),
 public.v56_team_applied_credit_adjustment_overview(uuid,date),
 public.v56_team_conservation_overview(uuid),
 public.v56_team_parent_finance_overview(uuid,uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_team_direct_refund_intake_overview(uuid,date),
 public.v56_team_applied_credit_adjustment_overview(uuid,date),
 public.v56_team_conservation_overview(uuid),
 public.v56_team_parent_finance_overview(uuid,uuid,date) to authenticated;

