-- V5.3 phase 2: immutable, manager-only Team lesson fee confirmations.
-- Apply exclusively to a disposable local Supabase for development/CI.
-- This does NOT collect money, allocate a payment, or modify V4 finance.
-- All amounts are integer TWD cents; no browser access to private tables.

create table tutor_private.v5_team_lesson_fees(
 lesson_id uuid primary key references public.v5_team_lessons(id) on delete restrict,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 project_id uuid not null,
 student_id uuid not null,
 teacher_user_id uuid not null references auth.users(id),
 subject text not null,
 lesson_start timestamptz not null,
 lesson_end timestamptz not null,
 duration_minutes integer not null check(duration_minutes between 1 and 1440),
 hourly_rate_cents bigint not null check(hourly_rate_cents between 0 and 100000000),
 amount_cents bigint not null check(amount_cents between 0 and 2400000000),
 currency text not null default 'TWD' check(currency='TWD'),
 confirmed_by uuid not null references auth.users(id),
 confirmed_at timestamptz not null default now()
);
create index v5_team_lesson_fees_period on
 tutor_private.v5_team_lesson_fees(team_id,lesson_start,teacher_user_id);
alter table tutor_private.v5_team_lesson_fees enable row level security;
revoke all on tutor_private.v5_team_lesson_fees
 from public,anon,authenticated;

create table tutor_private.v5_team_billing_audit(
 id bigint generated always as identity primary key,
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 lesson_id uuid not null references public.v5_team_lessons(id) on delete restrict,
 actor_id uuid not null references auth.users(id),
 event text not null check(event='fee_confirmed'),
 hourly_rate_cents bigint not null,
 amount_cents bigint not null,
 created_at timestamptz not null default now()
);
alter table tutor_private.v5_team_billing_audit enable row level security;
revoke all on tutor_private.v5_team_billing_audit
 from public,anon,authenticated;

-- Once a fee is confirmed, immutable financial fields of its linked lesson
-- must never be edited even by the manager. Free-text notes may still change.
-- Future fee corrections must append auditable adjustments in another phase.
create function tutor_private.v5_guard_billed_lesson()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from tutor_private.v5_team_lesson_fees f
   where f.lesson_id=old.id)
 and (old.team_id,old.project_id,old.student_id,old.teacher_user_id,
   old.subject,old.lesson_start,old.lesson_end,old.status)
 is distinct from
   (new.team_id,new.project_id,new.student_id,new.teacher_user_id,
   new.subject,new.lesson_start,new.lesson_end,new.status)
 then
   raise exception '已確認費用的課程不能直接更改計價內容'
     using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_guard_billed_lesson()
 from public,anon,authenticated;
create trigger v5_guard_billed_lesson
before update on public.v5_team_lessons
for each row execute function tutor_private.v5_guard_billed_lesson();

-- PostgreSQL transaction and lock order match governance-transfer RPCs:
-- lock the original workspace first; then lock the target lesson.
-- Only the CURRENT Team manager may confirm a completed, past lesson.
-- Rate and amount are snapshotted, never copied from client-calculated totals.
create function public.v5_confirm_team_lesson_fee(
 p_lesson_id uuid,p_hourly_rate_cents bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_workspace uuid;
 v_lesson public.v5_team_lessons%rowtype;
 v_seconds numeric;
 v_minutes integer;
 v_amount bigint;
begin
 if v_actor is null then
  raise exception '請先登入' using errcode='42501';
 end if;
 if p_lesson_id is null or p_hourly_rate_cents is null
   or p_hourly_rate_cents<0 or p_hourly_rate_cents>100000000 then
  raise exception '無效的課程或每小時金額' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_workspace
 from public.v5_team_lessons l
 join public.v5_teams t on t.id=l.team_id
 where l.id=p_lesson_id;
 if v_workspace is null then
  raise exception '課程不存在或無法確認' using errcode='42501';
 end if;
 perform 1 from public.workspaces w
 where w.id=v_workspace for update;
 if not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e
   on e.workspace_id=g.workspace_id
  where g.workspace_id=v_workspace
   and g.manager_user_id=v_actor and e.plan_code='team'
 ) then
  raise exception '只有現任 Team 管理者可確認課程費用'
    using errcode='42501';
 end if;
 select * into v_lesson from public.v5_team_lessons
 where id=p_lesson_id for update;
 if not found or v_lesson.status<>'completed'
   or v_lesson.lesson_end>now() then
  raise exception '只有已完成的過去課程可確認費用'
    using errcode='23514';
 end if;
 if exists(select 1 from tutor_private.v5_team_lesson_fees f
  where f.lesson_id=p_lesson_id) then
  raise exception '此課程費用已確認，不可重複入帳'
   using errcode='23505';
 end if;
 v_seconds:=extract(epoch from (v_lesson.lesson_end-v_lesson.lesson_start));
 if v_seconds<=0 or v_seconds>86400 or mod(v_seconds,60)<>0 then
  raise exception '課程須以整分鐘計價且不得超過24小時'
   using errcode='23514';
 end if;
 v_minutes:=(v_seconds/60)::integer;
 v_amount:=round(p_hourly_rate_cents::numeric*v_seconds/3600)::bigint;
 insert into tutor_private.v5_team_lesson_fees(
  lesson_id,team_id,project_id,student_id,teacher_user_id,
  subject,lesson_start,lesson_end,duration_minutes,
  hourly_rate_cents,amount_cents,confirmed_by)
 values(p_lesson_id,v_lesson.team_id,v_lesson.project_id,
  v_lesson.student_id,v_lesson.teacher_user_id,v_lesson.subject,
  v_lesson.lesson_start,v_lesson.lesson_end,v_minutes,
  p_hourly_rate_cents,v_amount,v_actor);
 insert into tutor_private.v5_team_billing_audit(
  team_id,lesson_id,actor_id,event,hourly_rate_cents,amount_cents)
 values(v_lesson.team_id,p_lesson_id,v_actor,'fee_confirmed',
  p_hourly_rate_cents,v_amount);
 return jsonb_build_object('lesson_id',p_lesson_id,'team_id',v_lesson.team_id,
  'currency','TWD','duration_minutes',v_minutes,
  'hourly_rate_cents',p_hourly_rate_cents,'amount_cents',v_amount,
  'status','confirmed');
end;$$;
revoke all on function public.v5_confirm_team_lesson_fee(uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.v5_confirm_team_lesson_fee(uuid,bigint)
 to authenticated;

-- Manager-only monthly read model. The dollar values NEVER appear on
-- v5_team_lessons, the student portal, or any teacher-visible relation.
-- Month grouping uses the Team's Taiwan-local date, not a UTC month boundary.
create function public.v5_team_billing_overview(
 p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_start timestamptz;
 v_end timestamptz;
 v_confirmed jsonb;
 v_pending jsonb;
 v_total bigint;
 v_count integer;
begin
 if v_actor is null or p_team_id is null or p_month is null then
  raise exception '無法取得 Team 帳務' using errcode='42501';
 end if;
 if p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception '請使用月份第一天' using errcode='22023';
 end if;
 if not exists(
  select 1 from public.v5_teams t
   join public.v5_team_governance g on g.workspace_id=t.anchor_workspace_id
   join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where t.id=p_team_id and g.manager_user_id=v_actor and e.plan_code='team'
 ) then
  raise exception '僅現任 Team 管理者可查看帳務' using errcode='42501';
 end if;
 v_start:=p_month::timestamp at time zone 'Asia/Taipei';
 v_end:=(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';
 select coalesce(jsonb_agg(jsonb_build_object(
   'lesson_id',f.lesson_id,'team_id',f.team_id,'project_id',f.project_id,
   'student_id',f.student_id,'student_name',s.display_name,
   'teacher_user_id',f.teacher_user_id,'subject',f.subject,
   'lesson_start',f.lesson_start,'lesson_end',f.lesson_end,
   'duration_minutes',f.duration_minutes,
   'hourly_rate_cents',f.hourly_rate_cents,
   'amount_cents',f.amount_cents,'confirmed_by',f.confirmed_by,
   'confirmed_at',f.confirmed_at)
   order by f.lesson_start,f.lesson_id),'[]'::jsonb),
  coalesce(sum(f.amount_cents),0)::bigint,
  count(*)::integer
 into v_confirmed,v_total,v_count
 from tutor_private.v5_team_lesson_fees f
 join public.v5_team_students s on s.id=f.student_id
 where f.team_id=p_team_id
  and f.lesson_start>=v_start and f.lesson_start<v_end;

 -- Completed lessons not yet charged are visible only to the Team manager.
 select coalesce(jsonb_agg(jsonb_build_object(
  'lesson_id',l.id,'team_id',l.team_id,'project_id',l.project_id,
  'student_id',l.student_id,'student_name',s.display_name,
  'teacher_user_id',l.teacher_user_id,'subject',l.subject,
  'lesson_start',l.lesson_start,'lesson_end',l.lesson_end)
  order by l.lesson_start,l.id),'[]'::jsonb)
 into v_pending
 from public.v5_team_lessons l
 join public.v5_team_students s on s.id=l.student_id
 left join tutor_private.v5_team_lesson_fees f on f.lesson_id=l.id
 where l.team_id=p_team_id and l.status='completed'
  and l.lesson_end<=now() and f.lesson_id is null
  and l.lesson_start>=v_start and l.lesson_start<v_end;
 return jsonb_build_object('team_id',p_team_id,'month',p_month,
  'currency','TWD','confirmed_total_cents',v_total,
  'confirmed_count',v_count,'confirmed_rows',v_confirmed,
  'pending_rows',v_pending);
end;$$;
revoke all on function public.v5_team_billing_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v5_team_billing_overview(uuid,date)
 to authenticated;
