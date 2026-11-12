-- V5.6 staged allocated-payment refund INTAKE, DISPOSABLE CI ONLY.
-- This migration records a manager-authorized request, not an approval,
-- reversal, liability, bank transfer or settlement. No amount changes here.
-- Original confirmed payment and allocation rows must remain immutable.
-- A follow-on additive migration will implement approvals and net settlement.

create table tutor_private.v56_team_direct_refund_intake(
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references tutor_private.v5_team_payment_reports(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 allocations jsonb not null check(jsonb_typeof(allocations)='array'),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 80),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 actor_id uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 unique(payment_id,idempotency_key),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_direct_refund_intake_team_student
 on tutor_private.v56_team_direct_refund_intake(team_id,student_id,requested_at);
alter table tutor_private.v56_team_direct_refund_intake enable row level security;
revoke all on tutor_private.v56_team_direct_refund_intake from public,anon,authenticated;
create trigger v56_direct_refund_intake_immutable
 before update or delete on tutor_private.v56_team_direct_refund_intake
 for each row execute function tutor_private.v56_reject_financial_history_mutation();

-- A request intentionally does NOT reserve the payment; the later approval
-- must revalidate available allocation capacity under the workspace lock.
create function public.v56_request_team_direct_refund(
 p_payment_id uuid,p_allocations jsonb,p_idempotency_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment tutor_private.v5_team_payment_reports%rowtype;
 v_existing tutor_private.v56_team_direct_refund_intake%rowtype;
 v_row record;
 v_seen uuid[]:='{}'::uuid[];
 v_total bigint:=0;
 v_allocated bigint;
 v_request uuid;
begin
 if v_actor is null or p_payment_id is null
  or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250
  or p_allocations is null or jsonb_typeof(p_allocations)<>'array' then
  raise exception '已分配付款退款申請參數無效' using errcode='22023';
 end if;
 if jsonb_array_length(p_allocations) not between 1 and 100 then
  raise exception '退款分配清單需包含 1 至 100 堂課' using errcode='22023';
 end if;

 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_payment_reports p join public.v5_teams t
  on t.id=p.team_id where p.id=p_payment_id;
 if v_anchor is null then
  raise exception '找不到此筆付款' using errcode='42501';
 end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team'
 ) then
  raise exception '僅現任 Team 管理者可申請已分配付款退款' using errcode='42501';
 end if;
 select * into v_payment from tutor_private.v5_team_payment_reports
  where id=p_payment_id for update;
 if not found or v_payment.status<>'confirmed' then
  raise exception '只接受已確認付款的退款申請' using errcode='23514';
 end if;
 select * into v_existing from tutor_private.v56_team_direct_refund_intake
  where payment_id=p_payment_id and idempotency_key=p_idempotency_key;
 if found then
  if v_existing.allocations<>p_allocations or v_existing.reason<>p_reason then
   raise exception '相同操作代碼不得改變原申請內容' using errcode='23505';
  end if;
  return jsonb_build_object('request_id',v_existing.id,
   'status','requested_no_settlement','amount_cents',v_existing.amount_cents,
   'currency','TWD','idempotent',true,'settlement_changed',false,'bank_verified',false);
 end if;

 for v_row in select a.lesson_id,a.amount_cents
  from jsonb_to_recordset(p_allocations) as a(lesson_id uuid,amount_cents bigint)
  order by a.lesson_id
 loop
  if v_row.lesson_id is null or v_row.amount_cents is null
   or v_row.amount_cents<=0 or v_row.lesson_id=any(v_seen) then
   raise exception '退款項目不得缺少課程、負數或重複' using errcode='23514';
  end if;
  v_seen:=array_append(v_seen,v_row.lesson_id);
  select a.amount_cents into v_allocated
  from tutor_private.v5_team_payment_allocations a
  join tutor_private.v5_team_lesson_fees f on f.lesson_id=a.lesson_id
  where a.payment_id=p_payment_id and a.lesson_id=v_row.lesson_id
   and f.team_id=v_payment.team_id and f.student_id=v_payment.student_id;
  if v_allocated is null or v_row.amount_cents>v_allocated then
   raise exception '退款申請只能涵蓋同 Team 學生已分配的原付款' using errcode='23514';
  end if;
  if v_total>v_payment.amount_cents-v_row.amount_cents then
   raise exception '退款申請總額不得超過付款' using errcode='23514';
  end if;
  v_total:=v_total+v_row.amount_cents;
 end loop;

 insert into tutor_private.v56_team_direct_refund_intake(
  payment_id,team_id,student_id,allocations,amount_cents,idempotency_key,
  reason,actor_id)
 values(p_payment_id,v_payment.team_id,v_payment.student_id,
  p_allocations,v_total,p_idempotency_key,p_reason,v_actor)
 returning id into v_request;
 return jsonb_build_object('request_id',v_request,
  'status','requested_no_settlement','amount_cents',v_total,
  'currency','TWD','idempotent',false,'settlement_changed',false,'bank_verified',false);
end;$$;
revoke all on function public.v56_request_team_direct_refund(uuid,jsonb,text,text)
 from public,anon,authenticated;
grant execute on function public.v56_request_team_direct_refund(uuid,jsonb,text,text)
 to authenticated;

-- Manager-only read model for intake, without claiming settlement or payout.
create function public.v56_team_direct_refund_intake_overview(
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
  'requested_at',r.requested_at,'status','requested_no_settlement',
  'settlement_changed',false,'bank_verified',false)
  order by r.requested_at,r.id),'[]'::jsonb)
 into v_rows from tutor_private.v56_team_direct_refund_intake r
 where r.team_id=p_team_id
  and r.requested_at>=p_month::timestamp at time zone 'Asia/Taipei'
  and r.requested_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 return jsonb_build_object('team_id',p_team_id,'month',p_month,'currency','TWD',
  'requests',v_rows,'settlement_changed',false,'bank_verified',false);
end;$$;
revoke all on function public.v56_team_direct_refund_intake_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_team_direct_refund_intake_overview(uuid,date)
 to authenticated;
