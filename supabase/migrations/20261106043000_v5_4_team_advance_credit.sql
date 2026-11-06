-- V5.4 phase 1: manager-confirmed advance credits and cross-subject offsets.
-- Local disposable CI only. No bank verification, refunds, or V4 writes.
-- TWD integer cents; private rows never exposed through PostgREST.

create table tutor_private.v5_team_advance_intents(
 payment_id uuid primary key references
  tutor_private.v5_team_payment_reports(id) on delete restrict,
 expected_credit_cents bigint not null check(expected_credit_cents>0),
 created_at timestamptz not null default now()
);
alter table tutor_private.v5_team_advance_intents enable row level security;
revoke all on tutor_private.v5_team_advance_intents from public,anon,authenticated;

create table tutor_private.v5_team_advance_credits(
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null unique references
  tutor_private.v5_team_payment_reports(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id)
  on delete restrict
);
create index v5_advance_credits_student
 on tutor_private.v5_team_advance_credits(team_id,student_id);
alter table tutor_private.v5_team_advance_credits enable row level security;
revoke all on tutor_private.v5_team_advance_credits from public,anon,authenticated;

create table tutor_private.v5_team_advance_operations(
 id uuid primary key default gen_random_uuid(),
 credit_id uuid not null references tutor_private.v5_team_advance_credits(id)
  on delete restrict,
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 80),
 requested_allocations jsonb not null check(jsonb_typeof(requested_allocations)='array'),
 amount_cents bigint not null check(amount_cents>0),
 confirmed_by uuid not null references auth.users(id),
 confirmed_at timestamptz not null default now(),
 unique(credit_id,idempotency_key)
);
alter table tutor_private.v5_team_advance_operations enable row level security;
revoke all on tutor_private.v5_team_advance_operations
 from public,anon,authenticated;

create table tutor_private.v5_team_advance_applications(
 operation_id uuid not null references tutor_private.v5_team_advance_operations(id)
  on delete restrict,
 credit_id uuid not null references tutor_private.v5_team_advance_credits(id)
  on delete restrict,
 lesson_id uuid not null references tutor_private.v5_team_lesson_fees(lesson_id)
  on delete restrict,
 amount_cents bigint not null check(amount_cents>0),
 created_at timestamptz not null default now(),
 primary key(operation_id,lesson_id)
);
create index v5_advance_applications_credit
 on tutor_private.v5_team_advance_applications(credit_id);
create index v5_advance_applications_lesson
 on tutor_private.v5_team_advance_applications(lesson_id);
alter table tutor_private.v5_team_advance_applications enable row level security;
revoke all on tutor_private.v5_team_advance_applications
 from public,anon,authenticated;

create table tutor_private.v5_team_advance_audit(
 id bigint generated always as identity primary key,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 payment_id uuid not null references
  tutor_private.v5_team_payment_reports(id) on delete restrict,
 credit_id uuid not null references
  tutor_private.v5_team_advance_credits(id) on delete restrict,
 operation_id uuid references tutor_private.v5_team_advance_operations(id)
  on delete restrict,
 actor_id uuid not null references auth.users(id),
 event text not null check(event in ('credit_created','credit_applied')),
 amount_cents bigint not null check(amount_cents>0),
 details jsonb not null default '[]'::jsonb,
 occurred_at timestamptz not null default now(),
 foreign key(student_id,team_id) references public.v5_team_students(id,team_id)
  on delete restrict
);
alter table tutor_private.v5_team_advance_audit enable row level security;
revoke all on tutor_private.v5_team_advance_audit from public,anon,authenticated;

-- A V5.4 pending payment may not be confirmed using the older V5.3
-- full-allocation RPC, since that would omit the required advance ledger.
create function tutor_private.v5_guard_advance_payment_confirmation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status='confirmed'
  and exists(select 1 from tutor_private.v5_team_advance_intents i
   where i.payment_id=old.id)
  and not exists(select 1 from tutor_private.v5_team_advance_credits c
   where c.payment_id=old.id)
 then
  raise exception '此付款必須透過預收款專用確認流程'
   using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_guard_advance_payment_confirmation()
 from public,anon,authenticated;
create trigger v5_guard_advance_payment_confirmation
 before update of status on tutor_private.v5_team_payment_reports
 for each row execute function tutor_private.v5_guard_advance_payment_confirmation();

-- Protect the combined per-lesson invariant for *existing* V5.3 payment RPCs
-- as well as V5.4 credit applications. Both RPC families first lock the Team's
-- anchor workspace, serializing financial confirmations and governance changes.
create function tutor_private.v5_guard_combined_lesson_settlement()
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
 select coalesce(sum(a.amount_cents),0)::bigint into v_direct
  from tutor_private.v5_team_payment_allocations a
  where a.lesson_id=new.lesson_id;
 select coalesce(sum(a.amount_cents),0)::bigint into v_advance
  from tutor_private.v5_team_advance_applications a
  where a.lesson_id=new.lesson_id;
 if v_direct+v_advance+new.amount_cents>v_fee.amount_cents then
  raise exception '直接分配與預收抵扣合計不得超過應收'
   using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_guard_combined_lesson_settlement()
 from public,anon,authenticated;
create trigger v5_guard_payment_combined_settlement
 before insert on tutor_private.v5_team_payment_allocations
 for each row execute function tutor_private.v5_guard_combined_lesson_settlement();
create trigger v5_guard_advance_combined_settlement
 before insert on tutor_private.v5_team_advance_applications
 for each row execute function tutor_private.v5_guard_combined_lesson_settlement();

-- Explicit overpayment path; the original V5.3 report RPC remains strict.
-- The intended credit is reserved up-front so direct allocation is bounded.
create function public.v5_report_team_payment_with_advance(
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
  and p.status='pending';
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
revoke all on function public.v5_report_team_payment_with_advance(
 uuid,uuid,bigint,date,text,text,bigint,text)
 from public,anon,authenticated;
grant execute on function public.v5_report_team_payment_with_advance(
 uuid,uuid,bigint,date,text,text,bigint,text) to authenticated;

-- Confirm a pending V5.4 report, splitting it into direct allocations and
-- precisely one original credit. All writes live in the same transaction.
create function public.v5_confirm_team_advance_payment(
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
revoke all on function public.v5_confirm_team_advance_payment(uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.v5_confirm_team_advance_payment(uuid,jsonb)
 to authenticated;

-- A read-only recommendation is not an application and never moves money.
create function public.v5_team_advance_overview(
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
  'available_cents',c.amount_cents-coalesce(a.used,0),
  'created_at',c.created_at) order by c.created_at,c.id),'[]'::jsonb),
  coalesce(sum(c.amount_cents-coalesce(a.used,0)),0)::bigint
 into v_credits,v_balance
 from tutor_private.v5_team_advance_credits c
 left join lateral(select sum(x.amount_cents)::bigint used
  from tutor_private.v5_team_advance_applications x
  where x.credit_id=c.id) a on true
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
revoke all on function public.v5_team_advance_overview(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.v5_team_advance_overview(uuid,uuid)
 to authenticated;

-- Manager-reviewed application; idempotency is tied to a single credit and
-- exact JSONB allocation payload. A retry returns the original result.
create function public.v5_apply_team_advance_credit(
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
revoke all on function public.v5_apply_team_advance_credit(uuid,jsonb,text)
 from public,anon,authenticated;
grant execute on function public.v5_apply_team_advance_credit(uuid,jsonb,text)
 to authenticated;
