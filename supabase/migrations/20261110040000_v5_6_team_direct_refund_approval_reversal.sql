-- V5.6 P0-A/B: manager decision and immutable direct-payment reversal.
-- DISPOSABLE CI ONLY. No Production authorization or external bank payout.
-- Approval atomically reopens receivables in the NET ledger, but does NOT
-- change the original payment, original allocation, or physical cash balance.
-- A manual payout / verified bank refund is deliberately NOT implemented here.

create table tutor_private.v56_team_direct_refund_decisions(
 request_id uuid primary key references tutor_private.v56_team_direct_refund_intake(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 payment_id uuid not null references tutor_private.v5_team_payment_reports(id) on delete restrict,
 approved boolean not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 actor_id uuid not null references auth.users(id),
 decided_at timestamptz not null default now(),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_direct_decisions_team_payment
 on tutor_private.v56_team_direct_refund_decisions(team_id,payment_id,decided_at);
alter table tutor_private.v56_team_direct_refund_decisions enable row level security;
revoke all on tutor_private.v56_team_direct_refund_decisions from public,anon,authenticated;
create trigger v56_direct_decisions_immutable before update or delete
 on tutor_private.v56_team_direct_refund_decisions for each row
 execute function tutor_private.v56_reject_financial_history_mutation();

create table tutor_private.v56_team_direct_refund_reversals(
 request_id uuid not null references tutor_private.v56_team_direct_refund_decisions(request_id) on delete restrict,
 payment_id uuid not null,
 lesson_id uuid not null,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 actor_id uuid not null references auth.users(id),
 reversed_at timestamptz not null default now(),
 primary key(request_id,lesson_id),
 foreign key(payment_id,lesson_id) references tutor_private.v5_team_payment_allocations(payment_id,lesson_id) on delete restrict,
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_direct_reversals_payment_lesson
 on tutor_private.v56_team_direct_refund_reversals(payment_id,lesson_id);
create index v56_direct_reversals_lesson
 on tutor_private.v56_team_direct_refund_reversals(lesson_id);
alter table tutor_private.v56_team_direct_refund_reversals enable row level security;
revoke all on tutor_private.v56_team_direct_refund_reversals from public,anon,authenticated;
create trigger v56_direct_reversals_immutable before update or delete
 on tutor_private.v56_team_direct_refund_reversals for each row
 execute function tutor_private.v56_reject_financial_history_mutation();

-- Every competing Team allocation, credit application and governance transfer
-- already takes the anchor workspace row lock. Revalidate all capacities
-- INSIDE that lock; the intake request itself never reserves funds.
create function public.v56_decide_team_direct_refund(
 p_request_id uuid,p_approve boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_req tutor_private.v56_team_direct_refund_intake%rowtype;
 v_payment tutor_private.v5_team_payment_reports%rowtype;
 v_prior tutor_private.v56_team_direct_refund_decisions%rowtype;
 v_item record;
 v_fee tutor_private.v5_team_lesson_fees%rowtype;
 v_original bigint;
 v_reversed bigint;
 v_sum bigint:=0;
 v_seen uuid[]:='{}'::uuid[];
 v_state text;
begin
 if v_actor is null or p_request_id is null or p_approve is null
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '已分配付款退款審核資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
  from tutor_private.v56_team_direct_refund_intake r
  join public.v5_teams t on t.id=r.team_id where r.id=p_request_id;
 if v_anchor is null then
  raise exception '退款申請不存在' using errcode='42501';
 end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team'
 ) then
  raise exception '僅現任 Team 管理者可審核已分配付款退款' using errcode='42501';
 end if;
 select * into v_req from tutor_private.v56_team_direct_refund_intake
  where id=p_request_id for update;
 select * into v_payment from tutor_private.v5_team_payment_reports
  where id=v_req.payment_id for update;
 if not found or v_payment.status<>'confirmed'
  or v_payment.team_id<>v_req.team_id or v_payment.student_id<>v_req.student_id then
  raise exception '原付款狀態或歸屬不符合審核條件' using errcode='23514';
 end if;
 select * into v_prior from tutor_private.v56_team_direct_refund_decisions
  where request_id=p_request_id;
 if found then
  if v_prior.approved is distinct from p_approve or v_prior.reason<>p_reason then
   raise exception '退款已審核，不得變更既有決定或理由' using errcode='23505';
  end if;
  return jsonb_build_object('request_id',p_request_id,
   'status',case when p_approve then 'approved_reversed_pending_manual_payout' else 'rejected' end,
   'amount_cents',v_prior.amount_cents,'idempotent',true,
   'settlement_changed',p_approve,'bank_verified',false,'manual_paid',false);
 end if;

 if p_approve then
  -- The amount may have been requested before other refund approvals.
  -- A second approval must therefore recheck ORIGINAL MINUS REVERSALS.
  for v_item in select x.lesson_id,x.amount_cents
   from jsonb_to_recordset(v_req.allocations) x(lesson_id uuid,amount_cents bigint)
   order by x.lesson_id
  loop
   if v_item.lesson_id is null or v_item.amount_cents is null
    or v_item.amount_cents<=0 or v_item.lesson_id=any(v_seen) then
    raise exception '退款申請分配紀錄無效' using errcode='23514';
   end if;
   v_seen:=array_append(v_seen,v_item.lesson_id);
   select * into v_fee from tutor_private.v5_team_lesson_fees
    where lesson_id=v_item.lesson_id for update;
   if not found or v_fee.team_id<>v_req.team_id
    or v_fee.student_id<>v_req.student_id then
    raise exception '不可審核跨 Team 或跨學生的退款分配' using errcode='42501';
   end if;
   select a.amount_cents into v_original
    from tutor_private.v5_team_payment_allocations a
    where a.payment_id=v_req.payment_id and a.lesson_id=v_item.lesson_id
    for update;
   if v_original is null then
    raise exception '找不到原始付款分配' using errcode='23514';
   end if;
   select coalesce(sum(x.amount_cents),0)::bigint into v_reversed
    from tutor_private.v56_team_direct_refund_reversals x
    where x.payment_id=v_req.payment_id and x.lesson_id=v_item.lesson_id;
   if v_reversed>v_original or v_item.amount_cents>v_original-v_reversed then
    raise exception '此課程已核准退款累計不得超過原付款分配' using errcode='23514';
   end if;
   v_sum:=v_sum+v_item.amount_cents;
  end loop;
  if v_sum<>v_req.amount_cents then
   raise exception '申請退款總額與原申請不一致' using errcode='23514';
  end if;
 end if;
 -- The decision and all per-lesson reversal rows are ONE SQL transaction.
 -- Any exception rolls them all back; no original allocation is updated.
 insert into tutor_private.v56_team_direct_refund_decisions(
  request_id,team_id,student_id,payment_id,approved,amount_cents,reason,actor_id)
 values(v_req.id,v_req.team_id,v_req.student_id,v_req.payment_id,
  p_approve,v_req.amount_cents,p_reason,v_actor);
 if p_approve then
  insert into tutor_private.v56_team_direct_refund_reversals(
   request_id,payment_id,lesson_id,team_id,student_id,amount_cents,actor_id)
  select v_req.id,v_req.payment_id,x.lesson_id,v_req.team_id,v_req.student_id,
   x.amount_cents,v_actor
  from jsonb_to_recordset(v_req.allocations) x(lesson_id uuid,amount_cents bigint);
 end if;
 v_state:=case when p_approve then 'approved_reversed_pending_manual_payout' else 'rejected' end;
 return jsonb_build_object('request_id',v_req.id,'status',v_state,
  'amount_cents',v_req.amount_cents,'currency','TWD',
  'idempotent',false,'settlement_changed',p_approve,
  'bank_verified',false,'manual_paid',false);
end;$$;
revoke all on function public.v56_decide_team_direct_refund(uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.v56_decide_team_direct_refund(uuid,boolean,text)
 to authenticated;

-- A separate manager-only NET settlement model. The legacy V5 gross
-- payment overview intentionally remains unchanged in this migration.
-- Consequently the legacy UI must not be used as a post-reversal net ledger.
-- All sums are per lesson, so multiple payments cannot multiply receivables.
create function public.v56_team_direct_refund_net_overview(
 p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_from timestamptz;
 v_until timestamptz;
 v_rows jsonb;
 v_due bigint;
 v_direct_gross bigint;
 v_reversed bigint;
 v_direct_net bigint;
 v_advance bigint;
 v_cash_received bigint;
 v_refund_liability bigint;
begin
 if v_actor is null or p_team_id is null or p_month is null
  or p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception '查詢月份無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor from public.v5_teams t where t.id=p_team_id;
 if v_anchor is null or not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可檢視退款後淨帳務' using errcode='42501';
 end if;
 v_from:=p_month::timestamp at time zone 'Asia/Taipei';
 v_until:=(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 select coalesce(jsonb_agg(jsonb_build_object(
   'lesson_id',f.lesson_id,'student_id',f.student_id,
   'subject',f.subject,'lesson_start',f.lesson_start,'amount_cents',f.amount_cents,
   'direct_gross_cents',coalesce(d.gross,0),
   'direct_reversed_cents',coalesce(r.reversed,0),
   'direct_net_allocated_cents',coalesce(d.gross,0)-coalesce(r.reversed,0),
   'advance_applied_cents',coalesce(a.used,0),
   'outstanding_cents',f.amount_cents-coalesce(d.gross,0)+coalesce(r.reversed,0)-coalesce(a.used,0))
  order by f.lesson_start,f.lesson_id),'[]'::jsonb),
  coalesce(sum(f.amount_cents-coalesce(d.gross,0)+coalesce(r.reversed,0)-coalesce(a.used,0)),0)::bigint,
  coalesce(sum(coalesce(d.gross,0)),0)::bigint,
  coalesce(sum(coalesce(r.reversed,0)),0)::bigint,
  coalesce(sum(coalesce(a.used,0)),0)::bigint
 into v_rows,v_due,v_direct_gross,v_reversed,v_advance
 from tutor_private.v5_team_lesson_fees f
 left join lateral(
  select sum(x.amount_cents)::bigint gross from tutor_private.v5_team_payment_allocations x
  where x.lesson_id=f.lesson_id
 ) d on true
 left join lateral(
  select sum(x.amount_cents)::bigint reversed from tutor_private.v56_team_direct_refund_reversals x
  where x.lesson_id=f.lesson_id
 ) r on true
 left join lateral(
  select sum(x.amount_cents)::bigint used from tutor_private.v5_team_advance_applications x
  where x.lesson_id=f.lesson_id
 ) a on true
 where f.team_id=p_team_id and f.lesson_start>=v_from and f.lesson_start<v_until;
 select coalesce(sum(p.amount_cents),0)::bigint into v_cash_received
 from tutor_private.v5_team_payment_reports p
 where p.team_id=p_team_id and p.status='confirmed';
 select coalesce(sum(d.amount_cents),0)::bigint into v_refund_liability
 from tutor_private.v56_team_direct_refund_decisions d
 where d.team_id=p_team_id and d.approved;
 -- A direct refund approval reopens a receivable and creates a payable
 -- liability. No direct manual-paid event exists yet: physical cash is NOT
 -- subtracted, and bank_verified is always false.
 return jsonb_build_object(
  'team_id',p_team_id,'month',p_month,'currency','TWD','lessons',v_rows,
  'outstanding_cents',v_due,'direct_gross_cents',v_direct_gross,
  'direct_reversed_cents',v_reversed,
  'direct_net_allocated_cents',v_direct_gross-v_reversed,
  'advance_applied_cents',v_advance,
  'all_time_confirmed_receipts_cents',v_cash_received,
  'all_time_direct_refund_liability_cents',v_refund_liability,
  'all_time_direct_refund_manual_paid_cents',0,
  'physical_bank_refund_verified',false,
  'legacy_gross_overview_is_net_authoritative',false);
end;$$;
revoke all on function public.v56_team_direct_refund_net_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_team_direct_refund_net_overview(uuid,date)
 to authenticated;
