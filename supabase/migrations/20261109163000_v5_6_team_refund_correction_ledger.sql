-- V5.6 incremental, additive Team accounting workflow. DISPOSABLE CI ONLY.
-- This file does NOT authorize Production migration. No V4 personal ledger writes.
-- Money: integer TWD cents; original confirmed fees, payments and allocations
-- remain immutable. This stage supports note/method corrections, pending voids,
-- and manager-approved refunds of *unapplied* advance credit only.
-- Allocated cash/credit chargebacks require a separate net-settlement design.

create table tutor_private.v56_team_pending_payment_voids(
 payment_id uuid primary key references tutor_private.v5_team_payment_reports(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 80),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
alter table tutor_private.v56_team_pending_payment_voids enable row level security;
revoke all on tutor_private.v56_team_pending_payment_voids from public,anon,authenticated;

create table tutor_private.v56_team_payment_corrections(
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references tutor_private.v5_team_payment_reports(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 corrected_field text not null check(corrected_field in ('note','method')),
 previous_value text not null,
 new_value text not null,
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 80),
 actor_id uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(payment_id,idempotency_key),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_payment_corrections_lookup on tutor_private.v56_team_payment_corrections(payment_id,recorded_at,id);
alter table tutor_private.v56_team_payment_corrections enable row level security;
revoke all on tutor_private.v56_team_payment_corrections from public,anon,authenticated;

create table tutor_private.v56_team_credit_refund_requests(
 id uuid primary key default gen_random_uuid(),
 credit_id uuid not null references tutor_private.v5_team_advance_credits(id) on delete restrict,
 payment_id uuid not null references tutor_private.v5_team_payment_reports(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 80),
 actor_id uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 unique(credit_id,idempotency_key),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_credit_refunds_team_student on tutor_private.v56_team_credit_refund_requests(team_id,student_id,requested_at);
alter table tutor_private.v56_team_credit_refund_requests enable row level security;
revoke all on tutor_private.v56_team_credit_refund_requests from public,anon,authenticated;

create table tutor_private.v56_team_credit_refund_events(
 id bigint generated always as identity primary key,
 request_id uuid not null references tutor_private.v56_team_credit_refund_requests(id) on delete restrict,
 event text not null check(event in ('approved','rejected','manual_paid')),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 manual_reference text check(manual_reference is null or char_length(manual_reference) between 8 and 80),
 recorded_on date,
 actor_id uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(),
 check((event='manual_paid' and manual_reference is not null and recorded_on is not null)
  or (event<>'manual_paid' and manual_reference is null and recorded_on is null))
);
create unique index v56_refund_decision_once
 on tutor_private.v56_team_credit_refund_events(request_id)
 where event in ('approved','rejected');
create unique index v56_refund_paid_once
 on tutor_private.v56_team_credit_refund_events(request_id)
 where event='manual_paid';
alter table tutor_private.v56_team_credit_refund_events enable row level security;
revoke all on tutor_private.v56_team_credit_refund_events from public,anon,authenticated;

-- End-user roles cannot write directly. Defense in depth against accidental
-- future service code overwriting immutable V5.6 activity/audit rows.
create function tutor_private.v56_reject_financial_history_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 raise exception 'V5.6 帳務稽核紀錄不可更新或刪除'
 using errcode='42501';
end;$$;
revoke all on function tutor_private.v56_reject_financial_history_mutation() from public,anon,authenticated;
create trigger v56_no_void_rewrite before update or delete on tutor_private.v56_team_pending_payment_voids
 for each row execute function tutor_private.v56_reject_financial_history_mutation();
create trigger v56_no_correction_rewrite before update or delete on tutor_private.v56_team_payment_corrections
 for each row execute function tutor_private.v56_reject_financial_history_mutation();
create trigger v56_no_refund_request_rewrite before update or delete on tutor_private.v56_team_credit_refund_requests
 for each row execute function tutor_private.v56_reject_financial_history_mutation();
create trigger v56_no_refund_event_rewrite before update or delete on tutor_private.v56_team_credit_refund_events
 for each row execute function tutor_private.v56_reject_financial_history_mutation();

-- All manager RPCs lock the existing V4 workspace anchor first; this is the
-- same lock acquired by V5.3/V5.4 allocations and governance transitions.
-- Role/plan checks are repeated within every invocation, never cached.

create function public.v56_void_team_pending_payment(
 p_payment_id uuid,p_idempotency_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment tutor_private.v5_team_payment_reports%rowtype;
 v_old tutor_private.v56_team_pending_payment_voids%rowtype;
begin
 if v_actor is null or p_payment_id is null or p_idempotency_key is null
  or char_length(p_idempotency_key) not between 8 and 80
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '沖銷參數無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_payment_reports p join public.v5_teams t
  on t.id=p.team_id where p.id=p_payment_id;
 if v_anchor is null then raise exception '付款不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可沖銷' using errcode='42501';
 end if;
 select * into v_payment from tutor_private.v5_team_payment_reports
  where id=p_payment_id for update;
 if not found or v_payment.status<>'pending' then
  raise exception '僅待確認付款可以直接沖銷' using errcode='23514';
 end if;
 select * into v_old from tutor_private.v56_team_pending_payment_voids
  where payment_id=p_payment_id;
 if found then
  if v_old.idempotency_key<>p_idempotency_key or v_old.reason<>p_reason then
   raise exception '此付款已被不同操作沖銷' using errcode='23505';
  end if;
  return jsonb_build_object('payment_id',p_payment_id,'status','void',
    'idempotent',true,'currency','TWD');
 end if;
 insert into tutor_private.v56_team_pending_payment_voids(
  payment_id,team_id,student_id,idempotency_key,reason,actor_id)
 values(p_payment_id,v_payment.team_id,v_payment.student_id,
  p_idempotency_key,p_reason,v_actor);
 return jsonb_build_object('payment_id',p_payment_id,'status','void',
  'idempotent',false,'currency','TWD');
end;$$;
revoke all on function public.v56_void_team_pending_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.v56_void_team_pending_payment(uuid,text,text) to authenticated;

create function public.v56_correct_team_payment_metadata(
 p_payment_id uuid,p_field text,p_new_value text,p_reason text,
 p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment tutor_private.v5_team_payment_reports%rowtype;
 v_old tutor_private.v56_team_payment_corrections%rowtype;
 v_previous text;
 v_id uuid;
begin
 if v_actor is null or p_payment_id is null or p_field not in ('note','method')
  or p_new_value is null or p_reason is null or
  char_length(btrim(p_reason)) not between 8 and 250
  or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80
  or (p_field='note' and char_length(p_new_value)>250)
  or (p_field='method' and p_new_value not in ('cash','bank_transfer','other')) then
  raise exception '更正資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from tutor_private.v5_team_payment_reports p join public.v5_teams t
  on t.id=p.team_id where p.id=p_payment_id;
 if v_anchor is null then raise exception '付款不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可更正' using errcode='42501';
 end if;
 select * into v_payment from tutor_private.v5_team_payment_reports
  where id=p_payment_id for update;
 if not found or v_payment.status<>'confirmed' then
  raise exception '更正僅適用已確認付款' using errcode='23514';
 end if;
 select * into v_old from tutor_private.v56_team_payment_corrections
  where payment_id=p_payment_id and idempotency_key=p_idempotency_key;
 if found then
  if v_old.corrected_field<>p_field or v_old.new_value<>p_new_value
   or v_old.reason<>p_reason then
   raise exception '更正操作代碼不得重複使用' using errcode='23505';
  end if;
  return jsonb_build_object('correction_id',v_old.id,'status','recorded',
   'idempotent',true);
 end if;
 select c.new_value into v_previous
 from tutor_private.v56_team_payment_corrections c
 where c.payment_id=p_payment_id and c.corrected_field=p_field
 order by c.recorded_at desc,c.id desc limit 1;
 if v_previous is null then
  v_previous:=case when p_field='method' then v_payment.method else v_payment.note end;
 end if;
 if v_previous=p_new_value then
  raise exception '新值與目前值相同，無須更正' using errcode='23514';
 end if;
 insert into tutor_private.v56_team_payment_corrections(
  payment_id,team_id,student_id,corrected_field,previous_value,
  new_value,reason,idempotency_key,actor_id)
 values(p_payment_id,v_payment.team_id,v_payment.student_id,p_field,
  v_previous,p_new_value,p_reason,p_idempotency_key,v_actor)
 returning id into v_id;
 return jsonb_build_object('correction_id',v_id,'payment_id',p_payment_id,
  'field',p_field,'status','recorded','idempotent',false);
end;$$;
revoke all on function public.v56_correct_team_payment_metadata(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.v56_correct_team_payment_metadata(uuid,text,text,text,text)
 to authenticated;

create function public.v56_request_team_credit_refund(
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
 select v_credit.amount_cents-
  coalesce((select sum(x.amount_cents) from tutor_private.v5_team_advance_applications x
   where x.credit_id=p_credit_id),0)-
  coalesce((select sum(q.amount_cents) from tutor_private.v56_team_credit_refund_requests q
   where q.credit_id=p_credit_id and exists(
    select 1 from tutor_private.v56_team_credit_refund_events e
     where e.request_id=q.id and e.event='approved')),0)
 into v_available;
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
revoke all on function public.v56_request_team_credit_refund(uuid,bigint,text,text)
 from public,anon,authenticated;
grant execute on function public.v56_request_team_credit_refund(uuid,bigint,text,text)
 to authenticated;

create function public.v56_decide_team_credit_refund(
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
  select c.amount_cents-
   coalesce((select sum(x.amount_cents) from tutor_private.v5_team_advance_applications x
    where x.credit_id=c.id),0)-
   coalesce((select sum(q.amount_cents) from tutor_private.v56_team_credit_refund_requests q
    where q.credit_id=c.id and exists(
     select 1 from tutor_private.v56_team_credit_refund_events e
     where e.request_id=q.id and e.event='approved')),0)
  into v_available
  from tutor_private.v5_team_advance_credits c where c.id=v_req.credit_id for update;
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
revoke all on function public.v56_decide_team_credit_refund(uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.v56_decide_team_credit_refund(uuid,boolean,text)
 to authenticated;

create function public.v56_record_team_refund_manual_paid(
 p_request_id uuid,p_reference text,p_paid_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_req tutor_private.v56_team_credit_refund_requests%rowtype;
 v_prior tutor_private.v56_team_credit_refund_events%rowtype;
begin
 if v_actor is null or p_request_id is null or p_reference is null
  or char_length(p_reference) not between 8 and 80 or p_paid_on is null
  or p_paid_on>(now() at time zone 'Asia/Taipei')::date
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250 then
  raise exception '人工退款確認資料無效' using errcode='22023';
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
  raise exception '僅現任 Team 管理者可登記人工退款' using errcode='42501';
 end if;
 select * into v_req from tutor_private.v56_team_credit_refund_requests
  where id=p_request_id for update;
 if not exists(select 1 from tutor_private.v56_team_credit_refund_events e
  where e.request_id=p_request_id and e.event='approved') then
  raise exception '尚未核准，不得記錄已人工退款' using errcode='23514';
 end if;
 select * into v_prior from tutor_private.v56_team_credit_refund_events
  where request_id=p_request_id and event='manual_paid';
 if found then
  if v_prior.manual_reference<>p_reference or v_prior.recorded_on<>p_paid_on
   or v_prior.reason<>p_reason then
   raise exception '退款紀錄已存在，不能覆寫' using errcode='23505';
  end if;
  return jsonb_build_object('request_id',p_request_id,'status','manual_paid',
   'idempotent',true,'bank_verified',false);
 end if;
 insert into tutor_private.v56_team_credit_refund_events(
  request_id,event,reason,manual_reference,recorded_on,actor_id)
 values(p_request_id,'manual_paid',p_reason,p_reference,p_paid_on,v_actor);
 return jsonb_build_object('request_id',p_request_id,'status','manual_paid',
  'idempotent',false,'bank_verified',false,'amount_cents',v_req.amount_cents);
end;$$;
revoke all on function public.v56_record_team_refund_manual_paid(uuid,text,date,text)
 from public,anon,authenticated;
grant execute on function public.v56_record_team_refund_manual_paid(uuid,text,date,text)
 to authenticated;

create function public.v56_team_adjustment_overview(
 p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_void jsonb;
 v_corrections jsonb;
 v_refunds jsonb;
begin
 if v_actor is null or p_team_id is null or p_month is null
  or p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception '查詢月份無效' using errcode='22023';
 end if;
 select anchor_workspace_id into v_anchor from public.v5_teams where id=p_team_id;
 if v_anchor is null or not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team') then
  raise exception '僅現任 Team 管理者可查詢更正與退款' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.payment_id,
  'student_id',p.student_id,'reason',p.reason,'actor_tail',right(p.actor_id::text,6),
  'recorded_at',p.created_at) order by p.created_at),'[]'::jsonb)
 into v_void
 from tutor_private.v56_team_pending_payment_voids p
 where p.team_id=p_team_id and p.created_at>=p_month::timestamp at time zone 'Asia/Taipei'
  and p.created_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.payment_id,
  'student_id',p.student_id,'field',p.corrected_field,'previous',p.previous_value,
  'new',p.new_value,'reason',p.reason,'recorded_at',p.recorded_at)
  order by p.recorded_at),'[]'::jsonb)
 into v_corrections from tutor_private.v56_team_payment_corrections p
 where p.team_id=p_team_id and p.recorded_at>=p_month::timestamp at time zone 'Asia/Taipei'
  and p.recorded_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 select coalesce(jsonb_agg(jsonb_build_object('request_id',r.id,
  'student_id',r.student_id,'credit_id',r.credit_id,
  'amount_cents',r.amount_cents,'requested_at',r.requested_at,
  'status',case when exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=r.id and e.event='manual_paid') then 'manual_paid'
   when exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=r.id and e.event='approved') then 'approved'
   when exists(select 1 from tutor_private.v56_team_credit_refund_events e
    where e.request_id=r.id and e.event='rejected') then 'rejected'
   else 'requested' end)
  order by r.requested_at),'[]'::jsonb)
 into v_refunds from tutor_private.v56_team_credit_refund_requests r
 where r.team_id=p_team_id and r.requested_at>=p_month::timestamp at time zone 'Asia/Taipei'
  and r.requested_at<(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 return jsonb_build_object('team_id',p_team_id,'month',p_month,'currency','TWD',
  'pending_voids',v_void,'corrections',v_corrections,'refunds',v_refunds,
  'refunds_bank_verified',false);
end;$$;
revoke all on function public.v56_team_adjustment_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_team_adjustment_overview(uuid,date) to authenticated;

-- Backward compatibility: V5.3/V5.4 existing RPCs now honor V5.6 holds
-- and pending-void tombstones. Immutable existing payment/credit rows remain.

-- V5.4 direct and advance payment capacity: exclude voided pending reports.
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
 select coalesce(sum(f.amount_cents-coalesce(d.cents,0)-coalesce(a.cents,0)),0)::bigint
 into v_due
 from tutor_private.v5_team_lesson_fees f
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
 where f.team_id=p_team_id and f.student_id=p_student_id;
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
 select coalesce(sum(f.amount_cents-
   coalesce(d.direct_cents,0)-coalesce(a.advance_cents,0)),0)::bigint
 into v_due
 from tutor_private.v5_team_lesson_fees f
 left join lateral(
  select sum(x.amount_cents)::bigint direct_cents
  from tutor_private.v5_team_payment_allocations x
  where x.lesson_id=f.lesson_id
 ) d on true
 left join lateral(
  select sum(x.amount_cents)::bigint advance_cents
  from tutor_private.v5_team_advance_applications x
  where x.lesson_id=f.lesson_id
 ) a on true
 where f.team_id=p_team_id and f.student_id=p_student_id;
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

-- Both confirmation paths reject voided pending payments.
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
  select coalesce(sum(a.amount_cents),0)::bigint into v_applied
   from tutor_private.v5_team_payment_allocations a
   where a.lesson_id=v_fee.lesson_id;
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
  select coalesce(sum(a.amount_cents),0)::bigint into v_applied
  from (
   select x.amount_cents from tutor_private.v5_team_payment_allocations x
    where x.lesson_id=v_fee.lesson_id
   union all
   select x.amount_cents from tutor_private.v5_team_advance_applications x
    where x.lesson_id=v_fee.lesson_id
  ) a;
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

-- Approved refunds reserve unused credit before a later offset.
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
 select (v_credit.amount_cents-coalesce(sum(a.amount_cents),0))::bigint
 into v_balance from tutor_private.v5_team_advance_applications a
 where a.credit_id=p_credit_id;
 -- Approved refunds reserve credit. Anchor workspace lock serializes
 -- both offset and refund approval to prevent negative available balances.
 select coalesce(sum(r.amount_cents),0)::bigint into v_refund_reserved
 from tutor_private.v56_team_credit_refund_requests r
 where r.credit_id=p_credit_id
 and exists(select 1 from tutor_private.v56_team_credit_refund_events e
   where e.request_id=r.id and e.event='approved');
 v_balance:=v_balance-v_refund_reserved;
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
  select coalesce(sum(a.amount_cents),0)::bigint into v_paid
   from (
    select x.amount_cents from tutor_private.v5_team_payment_allocations x
     where x.lesson_id=v_row.lesson_id
    union all
    select x.amount_cents from tutor_private.v5_team_advance_applications x
     where x.lesson_id=v_row.lesson_id
   ) a;
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

-- Manager-only existing read models deduct approved refund holds.
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
  'used_cents',coalesce(a.used,0),
  'refund_reserved_cents',coalesce(r.reserved,0),
  'available_cents',c.amount_cents-coalesce(a.used,0)-coalesce(r.reserved,0),
  'created_at',c.created_at) order by c.created_at,c.id),'[]'::jsonb),
  coalesce(sum(c.amount_cents-coalesce(a.used,0)-coalesce(r.reserved,0)),0)::bigint
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
   f.amount_cents-coalesce(d.paid,0)-coalesce(a.applied,0) as outstanding
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
   'direct_allocated_cents',coalesce(d.cents,0),
   'advance_applied_cents',coalesce(a.cents,0),
   'allocated_cents',coalesce(d.cents,0)+coalesce(a.cents,0),
   'outstanding_cents',f.amount_cents-coalesce(d.cents,0)-coalesce(a.cents,0)
  ) order by f.lesson_start,f.lesson_id),'[]'::jsonb),
  coalesce(sum(f.amount_cents-coalesce(d.cents,0)-coalesce(a.cents,0)),0)::bigint,
  coalesce(sum(coalesce(d.cents,0)),0)::bigint,
  coalesce(sum(coalesce(a.cents,0)),0)::bigint
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
   'subject',f.subject) order by x.lesson_id) details
  from tutor_private.v5_team_payment_allocations x
  join tutor_private.v5_team_lesson_fees f on f.lesson_id=x.lesson_id
  where x.payment_id=p.id
 ) d on true
 where p.team_id=p_team_id and p.received_on>=p_month
  and p.received_on<(p_month+interval '1 month')::date;

 -- This is an all-time balance (not a month-only balance). Every credit is
 -- counted exactly once and its applications are never added to receipts.
 select coalesce(sum(c.amount_cents-coalesce(ap.used_cents,0)-coalesce(r.reserved_cents,0)),0)::bigint
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

-- Explicit grants remain as originally reviewed; recreate defensively.
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
