-- V5.4 monthly reconciliation: one confirmed payment, one revenue receipt.
-- Outstanding = billed fees - direct allocations - advance applications.
-- Advance application is settlement of prepaid funds, NEVER new cash.
-- All read models are manager-only; no V4 payment or lesson changes.

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
   'note',p.note,'status',p.status,'reported_at',p.reported_at,
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
 select coalesce(sum(c.amount_cents-coalesce(ap.used_cents,0)),0)::bigint
 into v_advance_available
 from tutor_private.v5_team_advance_credits c
 left join lateral(
  select sum(x.amount_cents)::bigint used_cents
  from tutor_private.v5_team_advance_applications x
  where x.credit_id=c.id
 ) ap on true
 where c.team_id=p_team_id;

 return jsonb_build_object(
  'team_id',p_team_id,'month',p_month,'currency','TWD',
  'receivables',v_lesson_rows,'payments',v_payment_rows,
  'outstanding_cents',v_outstanding,
  'direct_allocated_cents',v_direct,
  'advance_applied_cents',v_advance_applied,
  'confirmed_payments_cents',v_confirmed,
  'advance_created_cents',v_advance_created,
  'advance_available_cents',v_advance_available);
end;$$;
revoke all on function public.v5_team_payment_overview(uuid,date)
 from public,anon,authenticated;
grant execute on function public.v5_team_payment_overview(uuid,date)
 to authenticated;

-- Keep the original V5.3 reporting contract strict and backward-compatible,
-- but reserve outstanding after BOTH credit offset and pending direct reports.
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
  and p.status='pending';
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
revoke all on function public.v5_report_team_payment(
 uuid,uuid,bigint,date,text,text,text) from public,anon,authenticated;
grant execute on function public.v5_report_team_payment(
 uuid,uuid,bigint,date,text,text,text) to authenticated;
