-- V5.6 P0-C/D. Applied advance-credit reversals and reserved refunds.
-- DISPOSABLE CI ONLY; no Production authorization or actual bank payout.
-- All source rows remain immutable. Manager approval and reversal are atomic.
create table tutor_private.v56_team_applied_credit_requests(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 credit_id uuid not null references tutor_private.v5_team_advance_credits(id) on delete restrict,
 entries jsonb not null check(jsonb_typeof(entries)='array'),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 mode text not null check(mode in ('restore_credit','refund_reserved')),
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 80),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 actor_id uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 unique(credit_id,idempotency_key),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
alter table tutor_private.v56_team_applied_credit_requests enable row level security;
revoke all on tutor_private.v56_team_applied_credit_requests from public,anon,authenticated;
create trigger v56_applied_credit_requests_immutable before update or delete
 on tutor_private.v56_team_applied_credit_requests for each row
 execute function tutor_private.v56_reject_financial_history_mutation();
create table tutor_private.v56_team_applied_credit_decisions(
 request_id uuid primary key references tutor_private.v56_team_applied_credit_requests(id) on delete restrict,
 approved boolean not null,
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 actor_id uuid not null references auth.users(id),
 decided_at timestamptz not null default now()
);
alter table tutor_private.v56_team_applied_credit_decisions enable row level security;
revoke all on tutor_private.v56_team_applied_credit_decisions from public,anon,authenticated;
create trigger v56_applied_credit_decisions_immutable before update or delete
 on tutor_private.v56_team_applied_credit_decisions for each row
 execute function tutor_private.v56_reject_financial_history_mutation();
create table tutor_private.v56_team_advance_application_reversals(
 request_id uuid not null references tutor_private.v56_team_applied_credit_decisions(request_id) on delete restrict,
 operation_id uuid not null,
 lesson_id uuid not null,
 credit_id uuid not null references tutor_private.v5_team_advance_credits(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 refund_reserved boolean not null,
 actor_id uuid not null references auth.users(id),
 reversed_at timestamptz not null default now(),
 primary key(request_id,operation_id,lesson_id),
 foreign key(operation_id,lesson_id) references tutor_private.v5_team_advance_applications(operation_id,lesson_id) on delete restrict,
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_adv_reversal_per_application on
 tutor_private.v56_team_advance_application_reversals(operation_id,lesson_id);
create index v56_adv_reversal_per_credit on
 tutor_private.v56_team_advance_application_reversals(credit_id);
alter table tutor_private.v56_team_advance_application_reversals enable row level security;
revoke all on tutor_private.v56_team_advance_application_reversals from public,anon,authenticated;
create trigger v56_adv_reversals_immutable before update or delete
 on tutor_private.v56_team_advance_application_reversals for each row
 execute function tutor_private.v56_reject_financial_history_mutation();

-- Rebuild helpers to include new reversal source; existing SQL14 RPCs use
-- these helpers, so capacity and read models automatically become net-based.
create or replace function tutor_private.v56_advance_net_for_lesson(p_lesson uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select (coalesce((select sum(a.amount_cents) from tutor_private.v5_team_advance_applications a
  where a.lesson_id=p_lesson),0)
 -coalesce((select sum(r.amount_cents) from tutor_private.v56_team_advance_application_reversals r
  where r.lesson_id=p_lesson),0))::bigint;
$$;
create or replace function tutor_private.v56_credit_net_applied(p_credit uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select (coalesce((select sum(a.amount_cents) from tutor_private.v5_team_advance_applications a
  where a.credit_id=p_credit),0)
 -coalesce((select sum(r.amount_cents) from tutor_private.v56_team_advance_application_reversals r
  where r.credit_id=p_credit),0))::bigint;
$$;
create or replace function tutor_private.v56_credit_total_reserved(p_credit uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select (
  coalesce((select sum(q.amount_cents) from tutor_private.v56_team_credit_refund_requests q
   where q.credit_id=p_credit and exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=q.id and e.event='approved')),0)
  +coalesce((select sum(r.amount_cents) from tutor_private.v56_team_advance_application_reversals r
   where r.credit_id=p_credit and r.refund_reserved),0)
 )::bigint;
$$;
revoke all on function tutor_private.v56_advance_net_for_lesson(uuid),
 tutor_private.v56_credit_net_applied(uuid),
 tutor_private.v56_credit_total_reserved(uuid) from public,anon,authenticated;

-- Immutable request records intent only; no money or settlement changes.
create function public.v56_request_team_applied_credit_adjustment(
 p_credit_id uuid,p_entries jsonb,p_mode text,p_idempotency_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_credit tutor_private.v5_team_advance_credits%rowtype;
 v_old tutor_private.v56_team_applied_credit_requests%rowtype;
 v_row record;
 v_original bigint;
 v_total bigint:=0;
 v_seen text[]:='{}';
 v_id uuid;
begin
 if v_actor is null or p_credit_id is null or p_entries is null
  or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100
  or p_mode not in ('restore_credit','refund_reserved') or p_mode is null
  or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '已抵扣預收款調整資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_advance_credits c join public.v5_teams t on t.id=c.team_id
 where c.id=p_credit_id;
 if v_anchor is null then raise exception '預收款不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 then raise exception '僅現任 Team 管理者可申請已抵扣預收款調整' using errcode='42501'; end if;
 select * into v_credit from tutor_private.v5_team_advance_credits where id=p_credit_id for update;
 select * into v_old from tutor_private.v56_team_applied_credit_requests
  where credit_id=p_credit_id and idempotency_key=p_idempotency_key;
 if found then
  if v_old.entries<>p_entries or v_old.mode<>p_mode or v_old.reason<>p_reason then
   raise exception '相同操作代碼不可更換調整內容' using errcode='23505';
  end if;
  return jsonb_build_object('request_id',v_old.id,'status','requested_no_settlement',
   'idempotent',true,'amount_cents',v_old.amount_cents,'bank_verified',false);
 end if;
 for v_row in select x.operation_id,x.lesson_id,x.amount_cents
 from jsonb_to_recordset(p_entries) x(operation_id uuid,lesson_id uuid,amount_cents bigint)
 order by x.lesson_id,x.operation_id
 loop
  if v_row.operation_id is null or v_row.lesson_id is null or v_row.amount_cents is null
   or v_row.amount_cents<1 or (v_row.operation_id::text||':'||v_row.lesson_id::text)=any(v_seen)
  then raise exception '預收抵扣調整項目無效或重複' using errcode='23514'; end if;
  v_seen:=array_append(v_seen,v_row.operation_id::text||':'||v_row.lesson_id::text);
  select a.amount_cents into v_original
  from tutor_private.v5_team_advance_applications a
  join tutor_private.v5_team_lesson_fees f on f.lesson_id=a.lesson_id
  where a.operation_id=v_row.operation_id and a.lesson_id=v_row.lesson_id
   and a.credit_id=p_credit_id and f.team_id=v_credit.team_id
   and f.student_id=v_credit.student_id;
  if v_original is null or v_row.amount_cents>v_original
  then raise exception '只能調整原 Team 學生已抵扣的金額' using errcode='23514'; end if;
  v_total:=v_total+v_row.amount_cents;
 end loop;
 if v_total>1000000000 then raise exception '調整總額過大' using errcode='23514'; end if;
 insert into tutor_private.v56_team_applied_credit_requests(
  team_id,student_id,credit_id,entries,amount_cents,mode,idempotency_key,reason,actor_id)
 values(v_credit.team_id,v_credit.student_id,p_credit_id,p_entries,v_total,
  p_mode,p_idempotency_key,p_reason,v_actor) returning id into v_id;
 return jsonb_build_object('request_id',v_id,'status','requested_no_settlement',
  'amount_cents',v_total,'idempotent',false,'bank_verified',false);
end;$$;
revoke all on function public.v56_request_team_applied_credit_adjustment(uuid,jsonb,text,text,text)
 from public,anon,authenticated;
grant execute on function public.v56_request_team_applied_credit_adjustment(uuid,jsonb,text,text,text)
 to authenticated;

create function public.v56_decide_team_applied_credit_adjustment(
 p_request_id uuid,p_approve boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_req tutor_private.v56_team_applied_credit_requests%rowtype;
 v_prior tutor_private.v56_team_applied_credit_decisions%rowtype;
 v_credit tutor_private.v5_team_advance_credits%rowtype;
 v_row record;
 v_original bigint;
 v_done bigint;
 v_fee tutor_private.v5_team_lesson_fees%rowtype;
 v_total bigint:=0;
begin
 if v_actor is null or p_request_id is null or p_approve is null
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '預收抵扣調整審核資料無效' using errcode='22023'; end if;
 select t.anchor_workspace_id into v_anchor from tutor_private.v56_team_applied_credit_requests q
 join public.v5_teams t on t.id=q.team_id where q.id=p_request_id;
 if v_anchor is null then raise exception '調整申請不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 then raise exception '僅現任 Team 管理者可核准調整' using errcode='42501'; end if;
 select * into v_req from tutor_private.v56_team_applied_credit_requests
  where id=p_request_id for update;
 select * into v_prior from tutor_private.v56_team_applied_credit_decisions
  where request_id=p_request_id;
 if found then
  if v_prior.approved is distinct from p_approve or v_prior.reason<>p_reason
  then raise exception '已審核調整不可覆寫' using errcode='23505'; end if;
  return jsonb_build_object('request_id',p_request_id,'status',
   case when p_approve then 'approved_reversed' else 'rejected' end,
   'idempotent',true,'settlement_changed',p_approve,'bank_verified',false);
 end if;
 select * into v_credit from tutor_private.v5_team_advance_credits
  where id=v_req.credit_id for update;
 if v_credit.team_id<>v_req.team_id or v_credit.student_id<>v_req.student_id
 then raise exception '原預收款身分不符' using errcode='42501'; end if;
 if p_approve then
  for v_row in select x.operation_id,x.lesson_id,x.amount_cents
   from jsonb_to_recordset(v_req.entries) x(operation_id uuid,lesson_id uuid,amount_cents bigint)
   order by x.lesson_id,x.operation_id
  loop
   select * into v_fee from tutor_private.v5_team_lesson_fees where lesson_id=v_row.lesson_id for update;
   if not found or v_fee.team_id<>v_req.team_id or v_fee.student_id<>v_req.student_id
   then raise exception '不可跨學生或 Team 核准預收沖帳' using errcode='42501'; end if;
   select a.amount_cents into v_original
   from tutor_private.v5_team_advance_applications a
   where a.operation_id=v_row.operation_id and a.lesson_id=v_row.lesson_id
    and a.credit_id=v_req.credit_id for update;
   select coalesce(sum(x.amount_cents),0)::bigint into v_done
   from tutor_private.v56_team_advance_application_reversals x
   where x.operation_id=v_row.operation_id and x.lesson_id=v_row.lesson_id;
   if v_original is null or v_row.amount_cents<1
    or v_done>v_original or v_row.amount_cents>v_original-v_done
   then raise exception '同一抵扣的累計調整不可超過原額' using errcode='23514'; end if;
   v_total:=v_total+v_row.amount_cents;
  end loop;
  if v_total<>v_req.amount_cents then raise exception '調整總額不一致' using errcode='23514'; end if;
 end if;
 insert into tutor_private.v56_team_applied_credit_decisions(request_id,approved,reason,actor_id)
 values(p_request_id,p_approve,p_reason,v_actor);
 if p_approve then
  insert into tutor_private.v56_team_advance_application_reversals(
   request_id,operation_id,lesson_id,credit_id,team_id,student_id,amount_cents,refund_reserved,actor_id)
  select p_request_id,x.operation_id,x.lesson_id,v_req.credit_id,v_req.team_id,
   v_req.student_id,x.amount_cents,v_req.mode='refund_reserved',v_actor
  from jsonb_to_recordset(v_req.entries) x(operation_id uuid,lesson_id uuid,amount_cents bigint);
  if tutor_private.v56_credit_available(v_req.credit_id)<0
  then raise exception '預收退款額度守恆失敗' using errcode='23514'; end if;
 end if;
 return jsonb_build_object('request_id',p_request_id,
  'status',case when p_approve then
   case when v_req.mode='refund_reserved' then 'approved_refund_reserved' else 'approved_restored_credit' end
   else 'rejected' end,'idempotent',false,'amount_cents',v_req.amount_cents,
  'settlement_changed',p_approve,'manual_paid',false,'bank_verified',false);
end;$$;
revoke all on function public.v56_decide_team_applied_credit_adjustment(uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.v56_decide_team_applied_credit_adjustment(uuid,boolean,text)
 to authenticated;

create function public.v56_team_applied_credit_adjustment_overview(p_team_id uuid,p_month date)
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
  'status',case when d.request_id is null then 'requested'
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
revoke all on function public.v56_team_applied_credit_adjustment_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_team_applied_credit_adjustment_overview(uuid,date)
 to authenticated;

-- All-time integrity test is per Team and counts each money source once.
create function public.v56_team_conservation_overview(p_team_id uuid)
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
  'cash_book_net_after_declared_unused_refunds_cents',v_confirmed_cash-v_credit_manual_paid,
  'bank_verified',false,'conservation_passed',true);
end;$$;
revoke all on function public.v56_team_conservation_overview(uuid)
 from public,anon,authenticated;
grant execute on function public.v56_team_conservation_overview(uuid)
 to authenticated;
