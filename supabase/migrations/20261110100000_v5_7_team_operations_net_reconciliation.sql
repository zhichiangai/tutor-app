-- V5.7 manager-only operations report now uses V5.6 immutable reverse ledger
-- net settlement for every project. Original V5.7 migration remains byte locked.
-- All other source rows, permissions and payment records remain unchanged.
-- Only isolated CI execution; NEVER authorized for Production.
-- V5.7 manager operations: read-only per-project and per-teacher summaries.
-- This is an additive migration in Draft PR #59, NOT an approved Production SQL.
-- All data remains separate from V4 personal lessons/payments. No finance writes.
-- All numeric accounting remains source-of-truth in V5.3/V5.4 ledgers.

create or replace function public.v5_team_operations_overview(
 p_team_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_anchor uuid;
 v_from timestamptz;
 v_until timestamptz;
 v_projects jsonb;
 v_teachers jsonb;
 v_activity jsonb;
begin
 if v_actor is null or p_team_id is null or p_month is null
  or p_month<>date_trunc('month',p_month::timestamp)::date then
  raise exception 'Team 營運月份無效' using errcode='22023';
 end if;
 select t.anchor_workspace_id into v_anchor
 from public.v5_teams t where t.id=p_team_id;
 if v_anchor is null or not exists(
  select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor
   and e.plan_code='team'
 ) then
  raise exception '只有現任 Team 管理者可以查看營運資料'
   using errcode='42501';
 end if;
 v_from:=p_month::timestamp at time zone 'Asia/Taipei';
 v_until:=(p_month::timestamp+interval '1 month') at time zone 'Asia/Taipei';

 -- Independent scalar subqueries are intentional: avoid multiplying fees
 -- across project member/student/lesson one-to-many relationships.
 select coalesce(jsonb_agg(jsonb_build_object(
  'project_id',p.id,'name',p.name,'status',p.status,
  'assigned_teacher_count',(
   select count(*)::integer from public.v5_team_project_members pm
   where pm.project_id=p.id and pm.workspace_id=v_anchor
  ),
  'enrolled_student_count',(
   select count(*)::integer from public.v5_team_enrollments en
   where en.project_id=p.id and en.team_id=p_team_id
  ),
  'scheduled_lessons',(
   select count(*)::integer from public.v5_team_lessons l
   where l.project_id=p.id and l.team_id=p_team_id
    and l.lesson_start>=v_from and l.lesson_start<v_until
    and l.status='scheduled'
  ),
  'completed_lessons',(
   select count(*)::integer from public.v5_team_lessons l
   where l.project_id=p.id and l.team_id=p_team_id
    and l.lesson_start>=v_from and l.lesson_start<v_until
    and l.status='completed'
  ),
  'cancelled_lessons',(
   select count(*)::integer from public.v5_team_lessons l
   where l.project_id=p.id and l.team_id=p_team_id
    and l.lesson_start>=v_from and l.lesson_start<v_until
    and l.status='cancelled'
  ),
  'unconfirmed_completed_lessons',(
   select count(*)::integer
   from public.v5_team_lessons l
   left join tutor_private.v5_team_lesson_fees f on f.lesson_id=l.id
   where l.project_id=p.id and l.team_id=p_team_id
    and l.lesson_start>=v_from and l.lesson_start<v_until
    and l.status='completed' and l.lesson_end<=now()
    and f.lesson_id is null
  ),
  'confirmed_receivable_cents',(
   select coalesce(sum(f.amount_cents),0)::bigint
   from tutor_private.v5_team_lesson_fees f
   where f.project_id=p.id and f.team_id=p_team_id
    and f.lesson_start>=v_from and f.lesson_start<v_until
  ),
  'direct_net_cents',(
   select coalesce(sum(tutor_private.v56_direct_net_for_lesson(f.lesson_id)),0)::bigint
   from tutor_private.v5_team_lesson_fees f
   where f.project_id=p.id and f.team_id=p_team_id
    and f.lesson_start>=v_from and f.lesson_start<v_until
  ),
  'advance_net_cents',(
   select coalesce(sum(tutor_private.v56_advance_net_for_lesson(f.lesson_id)),0)::bigint
   from tutor_private.v5_team_lesson_fees f
   where f.project_id=p.id and f.team_id=p_team_id
    and f.lesson_start>=v_from and f.lesson_start<v_until
  ),
  'outstanding_cents',(
   select coalesce(sum(
    f.amount_cents
     -tutor_private.v56_direct_net_for_lesson(f.lesson_id)
     -tutor_private.v56_advance_net_for_lesson(f.lesson_id)
   ),0)::bigint
   from tutor_private.v5_team_lesson_fees f
   where f.project_id=p.id and f.team_id=p_team_id
    and f.lesson_start>=v_from and f.lesson_start<v_until
  )
 ) order by p.name,p.id),'[]'::jsonb)
 into v_projects
 from public.v5_team_projects p where p.team_id=p_team_id;

 -- Keep team managers in the workload even when not roster-assigned.
 select coalesce(jsonb_agg(jsonb_build_object(
  'teacher_user_id',w.user_id,
  'assigned_project_count',(
   select count(distinct pm.project_id)::integer
   from public.v5_team_project_members pm
   where pm.workspace_id=v_anchor and pm.user_id=w.user_id
  ),
  'scheduled_lessons',(
   select count(*)::integer from public.v5_team_lessons l
   where l.team_id=p_team_id and l.teacher_user_id=w.user_id
    and l.lesson_start>=v_from and l.lesson_start<v_until
    and l.status='scheduled'
  ),
  'completed_lessons',(
   select count(*)::integer from public.v5_team_lessons l
   where l.team_id=p_team_id and l.teacher_user_id=w.user_id
    and l.lesson_start>=v_from and l.lesson_start<v_until
    and l.status='completed'
  )
 ) order by w.user_id),'[]'::jsonb)
 into v_teachers
 from (
  select r.user_id from public.v5_team_roster r where r.workspace_id=v_anchor
  union select v_actor
 ) w;

 -- Recent financial operations are a read-only activity feed. It does not
 -- claim to prove bank transfer, refund execution, alert delivery or receipt.
 select coalesce(jsonb_agg(jsonb_build_object(
  'kind',e.kind,'event',e.event,
  'actor_tail',right(e.actor_id::text,6),'occurred_at',e.event_time
 ) order by e.event_time desc,e.kind),'[]'::jsonb)
 into v_activity
 from (
  select kind,event,actor_id,event_time from (
   select 'lesson_fee'::text kind,a.event,a.actor_id,
    a.created_at as event_time
   from tutor_private.v5_team_billing_audit a
   where a.team_id=p_team_id
   union all
   select 'payment'::text kind,a.event,a.actor_id,a.occurred_at as event_time
   from tutor_private.v5_team_payment_audit a
   where a.team_id=p_team_id
   union all
   select 'advance'::text kind,a.event,a.actor_id,a.occurred_at as event_time
   from tutor_private.v5_team_advance_audit a
   where a.team_id=p_team_id
  ) all_events
  order by event_time desc,kind
  limit 20
 ) e;

 return jsonb_build_object(
  'team_id',p_team_id,'month',p_month,'currency','TWD',
  'projects',v_projects,'teacher_workload',v_teachers,
  'recent_activity',v_activity,
  'financial_authority','manager_only',
  'cash_verified_by_bank',false,
  'ledger_basis','net_after_immutable_reversals');
end;$$;

revoke all on function public.v5_team_operations_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v5_team_operations_overview(uuid,date)
 to authenticated;