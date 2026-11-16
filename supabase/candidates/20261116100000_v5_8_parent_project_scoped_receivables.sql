-- V5.8: parent-safe per-project labels for authorised Team/student receivables.
-- Forward-only additive JSON result change. No new SELECT grants on Team tables.
-- Preserve the fully updated 20261110090000 parent RPC including manual payout history.
-- Production migration requires an independently reviewed 62 -> 63 gate.
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
  'lesson_id',f.lesson_id,'project_id',f.project_id,'project_name',pr.name,
  'subject',f.subject,'lesson_start',f.lesson_start,
  'fee_cents',f.amount_cents,
  'direct_paid_net_cents',tutor_private.v56_direct_net_for_lesson(f.lesson_id),
  'advance_paid_net_cents',tutor_private.v56_advance_net_for_lesson(f.lesson_id),
  'outstanding_cents',f.amount_cents-
   tutor_private.v56_direct_net_for_lesson(f.lesson_id)-
   tutor_private.v56_advance_net_for_lesson(f.lesson_id))
  order by f.lesson_start,f.lesson_id),'[]'::jsonb)
 into v_rows from tutor_private.v5_team_lesson_fees f
 left join public.v5_team_projects pr on pr.id=f.project_id and pr.team_id=f.team_id
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
revoke all on function public.v56_team_parent_finance_overview(uuid,uuid,date)
 from public,anon,authenticated;
grant execute on function public.v56_team_parent_finance_overview(uuid,uuid,date)
 to authenticated;
