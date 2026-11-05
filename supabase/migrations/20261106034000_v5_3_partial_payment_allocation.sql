-- V5.3 phase 3: manually recorded Team payments and atomic partial
-- allocation to previously confirmed lesson receivables.
-- This is NOT a gateway transaction. Apply to disposable isolated CI only.
-- Do not touch V4 payments or the future V5.4 prepayment ledger.

create table tutor_private.v5_team_payment_reports(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 currency text not null default 'TWD' check(currency='TWD'),
 received_on date not null,
 method text not null check(method in('cash','bank_transfer','other')),
 reference text not null check(char_length(reference) between 8 and 80),
 note text not null default '' check(char_length(note)<=250),
 status text not null default 'pending' check(status in('pending','confirmed')),
 reported_by uuid not null references auth.users(id),
 reported_at timestamptz not null default now(),
 confirmed_by uuid references auth.users(id),
 confirmed_at timestamptz,
 unique(team_id,reference),
 foreign key(student_id,team_id) references
  public.v5_team_students(id,team_id) on delete restrict,
 check((status='pending' and confirmed_at is null and confirmed_by is null)
    or (status='confirmed' and confirmed_at is not null and confirmed_by is not null))
);
create index v5_team_payment_reports_month
 on tutor_private.v5_team_payment_reports(team_id,received_on,status);
alter table tutor_private.v5_team_payment_reports enable row level security;
revoke all on tutor_private.v5_team_payment_reports
 from public,anon,authenticated;

create table tutor_private.v5_team_payment_allocations(
 payment_id uuid not null references
  tutor_private.v5_team_payment_reports(id) on delete restrict,
 lesson_id uuid not null references
  tutor_private.v5_team_lesson_fees(lesson_id) on delete restrict,
 amount_cents bigint not null check(amount_cents>0),
 created_at timestamptz not null default now(),
 primary key(payment_id,lesson_id)
);
create index v5_team_payment_allocations_lesson
 on tutor_private.v5_team_payment_allocations(lesson_id);
alter table tutor_private.v5_team_payment_allocations enable row level security;
revoke all on tutor_private.v5_team_payment_allocations
 from public,anon,authenticated;

create table tutor_private.v5_team_payment_audit(
 id bigint generated always as identity primary key,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 payment_id uuid not null references
  tutor_private.v5_team_payment_reports(id) on delete restrict,
 actor_id uuid not null references auth.users(id),
 event text not null check(event in('reported','confirmed')),
 amount_cents bigint not null check(amount_cents>0),
 detail jsonb not null default '[]'::jsonb,
 occurred_at timestamptz not null default now()
);
alter table tutor_private.v5_team_payment_audit enable row level security;
revoke all on tutor_private.v5_team_payment_audit
 from public,anon,authenticated;

-- No direct UPDATE/DELETE/INSERT/SELECT for end-user roles: only the
-- authenticated, manager-checked RPCs below may access private tables.
-- Lock the V4 anchor workspace before any Team financial transaction so
-- governance transfer and fee confirmation cannot race past re-authorization.
create function public.v5_report_team_payment(
 p_team_id uuid,p_student_id uuid,p_amount_cents bigint,
 p_received_on date,p_method text,p_reference text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_payment uuid;
begin
 if v_actor is null or p_team_id is null or p_student_id is null
   or p_amount_cents is null or p_amount_cents<1
   or p_amount_cents>1000000000 or p_received_on is null
   or p_received_on>(now() at time zone 'Asia/Taipei')::date
   or p_method is null or p_method not in('cash','bank_transfer','other')
   or p_reference is null or char_length(p_reference) not between 8 and 80
   or p_note is null or char_length(p_note)>250 then
  raise exception '付款登錄資料無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor from public.v5_teams t
  where t.id=p_team_id;
 if v_anchor is null then
  raise exception '找不到此 Team' using errcode='42501';
 end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team'
 ) then
  raise exception '只有現任 Team 管理者可登錄付款'
    using errcode='42501';
 end if;
 if not exists(select 1 from public.v5_team_students s
  where s.team_id=p_team_id and s.id=p_student_id) then
  raise exception '學生不屬於此 Team' using errcode='42501';
 end if;
 insert into tutor_private.v5_team_payment_reports(
  team_id,student_id,amount_cents,received_on,method,reference,note,
  reported_by)
 values(p_team_id,p_student_id,p_amount_cents,p_received_on,p_method,
  p_reference,p_note,v_actor) returning id into v_payment;
 insert into tutor_private.v5_team_payment_audit(
  team_id,payment_id,actor_id,event,amount_cents)
 values(p_team_id,v_payment,v_actor,'reported',p_amount_cents);
 return jsonb_build_object('payment_id',v_payment,'status','pending',
  'amount_cents',p_amount_cents,'currency','TWD');
end;$$;
revoke all on function public.v5_report_team_payment(
 uuid,uuid,bigint,date,text,text,text) from public,anon,authenticated;
grant execute on function public.v5_report_team_payment(
 uuid,uuid,bigint,date,text,text,text) to authenticated;

-- Allocation payload:
-- [{"lesson_id":"uuid","amount_cents":50000}, ...]
-- The full payment must be allocated; overpayment is reserved for V5.4
-- (never silently marked as credit or "confirmed" here).
-- Every lesson fee row is locked in UUID order, preventing concurrent
-- payments from allocating beyond the confirmed receivable.
create function public.v5_confirm_team_payment_allocation(
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
revoke all on function public.v5_confirm_team_payment_allocation(uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.v5_confirm_team_payment_allocation(uuid,jsonb)
 to authenticated;

-- Manager-only receivables and payment ledger read model.
-- Outstanding is based on ALL confirmed allocations, not just the selected
-- report month. Payments filter by Taiwanese local received_on month.
create function public.v5_team_payment_overview(
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
begin
 if v_actor is null or p_team_id is null or p_month is null
   or p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception '查詢月份無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor from public.v5_teams t
  where t.id=p_team_id;
 if not exists(
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
 select coalesce(jsonb_agg(jsonb_build_object(
   'lesson_id',f.lesson_id,'student_id',f.student_id,
   'student_name',s.display_name,'subject',f.subject,
   'project_id',f.project_id,'teacher_user_id',f.teacher_user_id,
   'lesson_start',f.lesson_start,'amount_cents',f.amount_cents,
   'allocated_cents',coalesce(a.allocated_cents,0),
   'outstanding_cents',f.amount_cents-coalesce(a.allocated_cents,0)
  ) order by f.lesson_start,f.lesson_id),'[]'::jsonb),
  coalesce(sum(f.amount_cents-coalesce(a.allocated_cents,0)),0)::bigint
 into v_lesson_rows,v_outstanding
 from tutor_private.v5_team_lesson_fees f
 join public.v5_team_students s on s.id=f.student_id
 left join lateral(
  select sum(x.amount_cents)::bigint allocated_cents
  from tutor_private.v5_team_payment_allocations x
  where x.lesson_id=f.lesson_id
 ) a on true
 where f.team_id=p_team_id
   and f.lesson_start>=v_from and f.lesson_start<v_until;
 select coalesce(jsonb_agg(jsonb_build_object(
   'payment_id',p.id,'student_id',p.student_id,
   'student_name',s.display_name,'amount_cents',p.amount_cents,
   'received_on',p.received_on,'method',p.method,'reference',p.reference,
   'note',p.note,'status',p.status,'reported_at',p.reported_at,
   'confirmed_at',p.confirmed_at,
   'allocations',coalesce(a.details,'[]'::jsonb))
   order by p.received_on,p.id),'[]'::jsonb),
  coalesce(sum(p.amount_cents) filter(where p.status='confirmed'),0)::bigint
 into v_payment_rows,v_confirmed
 from tutor_private.v5_team_payment_reports p
 join public.v5_team_students s on s.id=p.student_id
 left join lateral(
   select jsonb_agg(jsonb_build_object(
    'lesson_id',x.lesson_id,'amount_cents',x.amount_cents,
    'subject',f.subject) order by x.lesson_id) details
   from tutor_private.v5_team_payment_allocations x
   join tutor_private.v5_team_lesson_fees f on f.lesson_id=x.lesson_id
   where x.payment_id=p.id
 ) a on true
 where p.team_id=p_team_id
  and p.received_on>=p_month
  and p.received_on<(p_month+interval '1 month')::date;
 return jsonb_build_object(
  'team_id',p_team_id,'month',p_month,'currency','TWD',
  'receivables',v_lesson_rows,'payments',v_payment_rows,
  'outstanding_cents',v_outstanding,
  'confirmed_payments_cents',v_confirmed);
end;$$;
revoke all on function public.v5_team_payment_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v5_team_payment_overview(uuid,date)
 to authenticated;
