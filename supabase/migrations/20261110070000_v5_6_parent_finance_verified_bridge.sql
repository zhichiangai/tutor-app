-- P0-E: explicit, two-sided Team/V4 family identity bridge.
-- DISPOSABLE CI ONLY. Team student UUID != V4 student UUID.
-- An existing V4 guardian link must remain LIVE on every finance read.
create table tutor_private.v56_team_family_bridge_proposals(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 team_student_id uuid not null,
 v4_student_id uuid not null references public.students(id) on delete restrict,
 v4_teacher_id uuid not null references auth.users(id),
 proposed_by uuid not null references auth.users(id),
 reason text not null check(char_length(btrim(reason)) between 8 and 250),
 proposed_at timestamptz not null default now(),
 foreign key(team_student_id,team_id) references public.v5_team_students(id,team_id) on delete restrict
);
create index v56_family_bridge_proposals_lookup
 on tutor_private.v56_team_family_bridge_proposals(team_id,team_student_id,v4_student_id);
alter table tutor_private.v56_team_family_bridge_proposals enable row level security;
revoke all on tutor_private.v56_team_family_bridge_proposals from public,anon,authenticated;
create trigger v56_family_proposals_immutable before update or delete
 on tutor_private.v56_team_family_bridge_proposals for each row
 execute function tutor_private.v56_reject_financial_history_mutation();
create table tutor_private.v56_team_family_bridge_acceptances(
 proposal_id uuid not null references tutor_private.v56_team_family_bridge_proposals(id) on delete restrict,
 guardian_id uuid not null references auth.users(id),
 accepted_at timestamptz not null default now(),
 primary key(proposal_id,guardian_id)
);
alter table tutor_private.v56_team_family_bridge_acceptances enable row level security;
revoke all on tutor_private.v56_team_family_bridge_acceptances from public,anon,authenticated;
create trigger v56_family_acceptances_immutable before update or delete
 on tutor_private.v56_team_family_bridge_acceptances for each row
 execute function tutor_private.v56_reject_financial_history_mutation();
create table tutor_private.v56_team_family_bridge_revocations(
 proposal_id uuid not null references tutor_private.v56_team_family_bridge_proposals(id) on delete restrict,
 guardian_id uuid not null references auth.users(id),
 revoked_at timestamptz not null default now(),
 primary key(proposal_id,guardian_id)
);
alter table tutor_private.v56_team_family_bridge_revocations enable row level security;
revoke all on tutor_private.v56_team_family_bridge_revocations from public,anon,authenticated;
create trigger v56_family_revocations_immutable before update or delete
 on tutor_private.v56_team_family_bridge_revocations for each row
 execute function tutor_private.v56_reject_financial_history_mutation();

create function public.v56_propose_team_family_bridge(
 p_team_student_id uuid,p_v4_student_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());v_team uuid;v_anchor uuid;v_id uuid;
begin
 if v_actor is null or p_team_student_id is null or p_v4_student_id is null
  or p_reason is null or char_length(btrim(p_reason)) not between 8 and 250
 then raise exception '家長對應提案資料無效' using errcode='22023'; end if;
 select s.team_id,t.anchor_workspace_id into v_team,v_anchor
 from public.v5_team_students s join public.v5_teams t on t.id=s.team_id
 where s.id=p_team_student_id;
 if v_anchor is null then raise exception 'Team 學生不存在' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_anchor for update;
 if not exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=v_anchor and g.manager_user_id=v_actor and e.plan_code='team')
 then raise exception '僅現任 Team 管理者可提出家長對應' using errcode='42501'; end if;
 -- Explicit pre-existing V4 ownership is required; no identifier/name guessing.
 if not exists(select 1 from public.students s
  where s.id=p_v4_student_id and s.teacher_id=v_actor)
 then raise exception '此 V4 學生不屬於目前管理者' using errcode='42501'; end if;
 insert into tutor_private.v56_team_family_bridge_proposals(
  team_id,team_student_id,v4_student_id,v4_teacher_id,proposed_by,reason)
 values(v_team,p_team_student_id,p_v4_student_id,v_actor,v_actor,p_reason)
 returning id into v_id;
 return jsonb_build_object('proposal_id',v_id,'team_id',v_team,
  'status','proposed_waiting_guardian_acceptance','finance_shared',false);
end;$$;
revoke all on function public.v56_propose_team_family_bridge(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.v56_propose_team_family_bridge(uuid,uuid,text)
 to authenticated;

create function public.v56_my_team_family_proposals()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());v_rows jsonb;
begin
 if v_actor is null then raise exception '請先登入' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'proposal_id',p.id,'team_id',p.team_id,'team_student_id',p.team_student_id,
  'display_name',s.display_name,'status',
  case when x.proposal_id is not null then 'revoked'
   when a.proposal_id is not null then 'accepted' else 'pending' end)
  order by p.proposed_at,p.id),'[]'::jsonb) into v_rows
 from tutor_private.v56_team_family_bridge_proposals p
 join public.v5_team_students s on s.id=p.team_student_id and s.team_id=p.team_id
 join public.v5_teams t on t.id=p.team_id
 join public.v5_workspace_entitlements e on e.workspace_id=t.anchor_workspace_id and e.plan_code='team'
 left join tutor_private.v56_team_family_bridge_acceptances a
  on a.proposal_id=p.id and a.guardian_id=v_actor
 left join tutor_private.v56_team_family_bridge_revocations x
  on x.proposal_id=p.id and x.guardian_id=v_actor
 where exists(select 1 from public.student_guardians sg
  where sg.student_id=p.v4_student_id and sg.teacher_id=p.v4_teacher_id
   and sg.guardian_id=v_actor)
  and exists(select 1 from public.students vs where vs.id=p.v4_student_id
   and vs.teacher_id=p.v4_teacher_id);
 return jsonb_build_object('proposals',v_rows);
end;$$;
revoke all on function public.v56_my_team_family_proposals()
 from public,anon,authenticated;
grant execute on function public.v56_my_team_family_proposals() to authenticated;

create function public.v56_respond_team_family_proposal(p_proposal_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());v_proposal tutor_private.v56_team_family_bridge_proposals%rowtype;
begin
 if v_actor is null or p_proposal_id is null or p_accept is null then
  raise exception '對應確認參數無效' using errcode='22023'; end if;
 select * into v_proposal from tutor_private.v56_team_family_bridge_proposals
 where id=p_proposal_id for update;
 if not found or not exists(select 1 from public.student_guardians sg
  where sg.student_id=v_proposal.v4_student_id and sg.teacher_id=v_proposal.v4_teacher_id
   and sg.guardian_id=v_actor)
  or not exists(select 1 from public.students s
   where s.id=v_proposal.v4_student_id and s.teacher_id=v_proposal.v4_teacher_id)
 then raise exception '沒有此學生的有效家長連結' using errcode='42501'; end if;
 if p_accept then
  if exists(select 1 from tutor_private.v56_team_family_bridge_revocations x
   where x.proposal_id=p_proposal_id and x.guardian_id=v_actor)
  then raise exception '此對應已撤回，需重新建立提案' using errcode='23505'; end if;
  insert into tutor_private.v56_team_family_bridge_acceptances(proposal_id,guardian_id)
  values(p_proposal_id,v_actor) on conflict do nothing;
 else
  if not exists(select 1 from tutor_private.v56_team_family_bridge_acceptances a
   where a.proposal_id=p_proposal_id and a.guardian_id=v_actor)
  then raise exception '尚未接受的連結不能解除' using errcode='23514'; end if;
  insert into tutor_private.v56_team_family_bridge_revocations(proposal_id,guardian_id)
  values(p_proposal_id,v_actor) on conflict do nothing;
 end if;
 return jsonb_build_object('proposal_id',p_proposal_id,
  'status',case when p_accept then 'accepted' else 'revoked' end,
  'bank_verified',false);
end;$$;
revoke all on function public.v56_respond_team_family_proposal(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.v56_respond_team_family_proposal(uuid,boolean)
 to authenticated;

-- Parent-only, family-specific ledger. Every call re-evaluates LIVE guardian
-- relationship; unlink revokes even with a still-valid JWT. No Team hourly
-- rates, teacher cost, internal Team salary or other student ledger.
create function public.v56_team_parent_finance_overview(
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
  'lesson_id',f.lesson_id,'subject',f.subject,'lesson_start',f.lesson_start,
  'fee_cents',f.amount_cents,
  'direct_paid_net_cents',tutor_private.v56_direct_net_for_lesson(f.lesson_id),
  'advance_paid_net_cents',tutor_private.v56_advance_net_for_lesson(f.lesson_id),
  'outstanding_cents',f.amount_cents-
   tutor_private.v56_direct_net_for_lesson(f.lesson_id)-
   tutor_private.v56_advance_net_for_lesson(f.lesson_id))
  order by f.lesson_start,f.lesson_id),'[]'::jsonb)
 into v_rows from tutor_private.v5_team_lesson_fees f
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
