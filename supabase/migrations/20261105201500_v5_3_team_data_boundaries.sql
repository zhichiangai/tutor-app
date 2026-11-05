-- V5.3 phase 1: separate Team student/lesson data from a V4 personal
-- workspace. This migration MUST run in the disposable local Supabase only.
-- It intentionally does not copy, move, or modify V4 students, lessons,
-- payments, guardians, existing student-seat ledgers, or Auth identities.

-- The anchor links V5.2 metadata to a durable Team identity. Team IDs never
-- depend on an individual teacher's V4 ownership.
create table public.v5_teams (
 id uuid primary key default gen_random_uuid(),
 anchor_workspace_id uuid not null unique
   references public.workspaces(id) on delete restrict,
 created_at timestamptz not null default now()
);
alter table public.v5_teams enable row level security;
revoke all on public.v5_teams from public,anon,authenticated;
grant select on public.v5_teams to authenticated;
create policy v5_team_member_or_manager_select on public.v5_teams
 for select to authenticated using(
  exists(select 1 from public.v5_team_governance g
   where g.workspace_id=public.v5_teams.anchor_workspace_id
    and g.manager_user_id=(select auth.uid()))
  or exists(select 1 from public.v5_team_roster r
   where r.workspace_id=public.v5_teams.anchor_workspace_id
    and r.user_id=(select auth.uid()))
 );

-- Existing Team governance becomes one Team, but no personal business data
-- is grandfathered into Team storage.
insert into public.v5_teams(anchor_workspace_id)
select workspace_id from public.v5_team_governance
on conflict(anchor_workspace_id) do nothing;

create function tutor_private.v5_seed_team_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.v5_teams(anchor_workspace_id)
 values(new.workspace_id) on conflict(anchor_workspace_id) do nothing;
 return new;
end;$$;
revoke all on function tutor_private.v5_seed_team_identity()
 from public,anon,authenticated;
create trigger v5_seed_team_identity after insert on public.v5_team_governance
for each row execute function tutor_private.v5_seed_team_identity();

-- Keep V5.2 project URLs and existing write APIs unchanged while introducing
-- a mandatory stable Team reference. The trigger fills it for new projects.
alter table public.v5_team_projects add column team_id uuid;
update public.v5_team_projects p
set team_id=t.id from public.v5_teams t
where p.workspace_id=t.anchor_workspace_id;
alter table public.v5_team_projects
 alter column team_id set not null;
alter table public.v5_team_projects
 add constraint v5_project_team_fk foreign key(team_id)
 references public.v5_teams(id) on delete restrict;
alter table public.v5_team_projects
 add constraint v5_project_team_pair_unique unique(id,team_id);

create function tutor_private.v5_attach_project_to_team()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_team uuid;
begin
 select t.id into v_team from public.v5_teams t
 where t.anchor_workspace_id=new.workspace_id;
 if v_team is null or (new.team_id is not null and new.team_id<>v_team) then
  raise exception '專案 Team 歸屬不符' using errcode='23514';
 end if;
 new.team_id:=v_team;
 return new;
end;$$;
revoke all on function tutor_private.v5_attach_project_to_team()
 from public,anon,authenticated;
create trigger v5_attach_project_to_team
before insert on public.v5_team_projects for each row
execute function tutor_private.v5_attach_project_to_team();

-- Cumulative Team students are not V4 personal students. The lifetime ledger
-- survives student deletion; no public API can reset it.
create table public.v5_team_students(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 display_name text not null check(char_length(btrim(display_name)) between 1 and 100),
 created_by uuid not null references auth.users(id),
 is_archived boolean not null default false,
 created_at timestamptz not null default now(),
 unique(id,team_id)
);
alter table public.v5_team_students enable row level security;
revoke all on public.v5_team_students from public,anon,authenticated;
grant select,insert on public.v5_team_students to authenticated;
grant update(display_name,is_archived) on public.v5_team_students to authenticated;

create table tutor_private.v5_team_student_seat_ledger(
 team_id uuid not null references public.v5_teams(id) on delete restrict,
 student_id uuid not null,
 first_seen_at timestamptz not null default now(),
 primary key(team_id,student_id)
);
alter table tutor_private.v5_team_student_seat_ledger enable row level security;
revoke all on tutor_private.v5_team_student_seat_ledger
 from public,anon,authenticated;

create function tutor_private.v5_team_student_quota_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;v_plan text;v_bonus int;v_used int;
begin
 select t.anchor_workspace_id into v_workspace from public.v5_teams t
 where t.id=new.team_id for update;
 if not found then raise exception 'Team 不存在' using errcode='23503'; end if;
 select e.plan_code,e.extra_student_seats into v_plan,v_bonus
 from public.v5_workspace_entitlements e
 where e.workspace_id=v_workspace;
 if v_plan<>'team' then
  raise exception '必須啟用 Team 才能新增團隊學生' using errcode='42501';
 end if;
 select count(*)::int into v_used from tutor_private.v5_team_student_seat_ledger l
 where l.team_id=new.team_id;
 if v_used>=100+v_bonus then
  raise exception '團隊累計學生名額已滿' using errcode='23514';
 end if;
 if exists(select 1 from tutor_private.v5_team_student_seat_ledger l
  where l.team_id=new.team_id and l.student_id=new.id) then
  raise exception '學生識別碼不可重複使用' using errcode='23505';
 end if;
 insert into tutor_private.v5_team_student_seat_ledger(team_id,student_id)
 values(new.team_id,new.id);
 return new;
end;$$;
revoke all on function tutor_private.v5_team_student_quota_guard()
 from public,anon,authenticated;
create trigger v5_team_student_quota_guard
before insert on public.v5_team_students for each row
execute function tutor_private.v5_team_student_quota_guard();

-- A student can attend multiple Team projects without being charged twice.
-- Same-Team composite foreign keys prevent attaching a student to a project
-- belonging to another Team.
create table public.v5_team_enrollments(
 team_id uuid not null,
 student_id uuid not null,
 project_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(student_id,project_id),
 unique(student_id,project_id,team_id),
 foreign key(student_id,team_id) references
   public.v5_team_students(id,team_id) on delete restrict,
 foreign key(project_id,team_id) references
   public.v5_team_projects(id,team_id) on delete restrict
);
alter table public.v5_team_enrollments enable row level security;
revoke all on public.v5_team_enrollments from public,anon,authenticated;
grant select,insert,delete on public.v5_team_enrollments to authenticated;

-- Every Team student is visible only to its current manager or to a teacher
-- with an active project assignment to one of the student's enrollments.
-- Enrollments SELECT does not depend on students SELECT (no RLS recursion).
create policy v5_team_student_manager_or_assigned_select
 on public.v5_team_students for select to authenticated using(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
    on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_students.team_id
   and g.manager_user_id=(select auth.uid()))
 or exists(select 1 from public.v5_team_enrollments en
  join public.v5_team_project_members pm
    on pm.project_id=en.project_id
  join public.v5_team_roster r
    on r.workspace_id=pm.workspace_id and r.user_id=pm.user_id
  where en.team_id=public.v5_team_students.team_id
    and en.student_id=public.v5_team_students.id
    and pm.user_id=(select auth.uid()))
);
create policy v5_team_student_manager_insert
 on public.v5_team_students for insert to authenticated with check(
 created_by=(select auth.uid()) and
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
    on g.workspace_id=t.anchor_workspace_id
  join public.v5_workspace_entitlements e
    on e.workspace_id=g.workspace_id
  where t.id=public.v5_team_students.team_id
    and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
);
create policy v5_team_student_manager_update
 on public.v5_team_students for update to authenticated using(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
    on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_students.team_id
   and g.manager_user_id=(select auth.uid()))
) with check(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
    on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_students.team_id
   and g.manager_user_id=(select auth.uid()))
);

create policy v5_team_enrollment_manager_or_assigned_select
 on public.v5_team_enrollments for select to authenticated using(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
    on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_enrollments.team_id
   and g.manager_user_id=(select auth.uid()))
 or exists(select 1 from public.v5_team_project_members pm
  join public.v5_team_roster r on r.workspace_id=pm.workspace_id
   and r.user_id=pm.user_id
  where pm.project_id=public.v5_team_enrollments.project_id
   and pm.user_id=(select auth.uid()))
);
create policy v5_team_enrollment_manager_insert
 on public.v5_team_enrollments for insert to authenticated with check(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
   on g.workspace_id=t.anchor_workspace_id
  join public.v5_workspace_entitlements e
   on e.workspace_id=g.workspace_id
  where t.id=public.v5_team_enrollments.team_id
    and g.manager_user_id=(select auth.uid())
    and e.plan_code='team')
);
create policy v5_team_enrollment_manager_delete
 on public.v5_team_enrollments for delete to authenticated using(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
   on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_enrollments.team_id
   and g.manager_user_id=(select auth.uid()))
);

-- Team lessons are new records, never a copy of V4 lesson_records. There is
-- intentionally no payment/receipt column or access to V4 finance tables.
create table public.v5_team_lessons(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null,
 project_id uuid not null,
 student_id uuid not null,
 teacher_user_id uuid not null references auth.users(id),
 subject text not null check(char_length(btrim(subject)) between 1 and 100),
 lesson_start timestamptz not null,
 lesson_end timestamptz not null,
 status text not null default 'scheduled'
   check(status in('scheduled','completed','cancelled')),
 notes text not null default '',
 created_at timestamptz not null default now(),
 check(lesson_end>lesson_start),
 foreign key(student_id,project_id,team_id)
  references public.v5_team_enrollments(student_id,project_id,team_id)
  on delete restrict
);
create index v5_team_lesson_by_team_project
 on public.v5_team_lessons(team_id,project_id,lesson_start);
alter table public.v5_team_lessons enable row level security;
revoke all on public.v5_team_lessons from public,anon,authenticated;
grant select,insert on public.v5_team_lessons to authenticated;
grant update(subject,lesson_start,lesson_end,status,notes)
 on public.v5_team_lessons to authenticated;

-- Membership and active assignment are checked when making a new lesson.
-- History persists when the original teacher is later removed.
create function tutor_private.v5_team_lesson_assignment_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_ws uuid; v_status text;
begin
 select p.workspace_id,p.status into v_ws,v_status
 from public.v5_team_projects p
 where p.id=new.project_id and p.team_id=new.team_id;
 if v_status is distinct from 'active' then
  raise exception 'Team 專案不存在或已封存' using errcode='23514'; end if;
 if not exists(select 1 from public.v5_team_roster r
  join public.v5_team_project_members pm
   on pm.workspace_id=r.workspace_id and pm.user_id=r.user_id
  where r.workspace_id=v_ws and r.user_id=new.teacher_user_id
   and pm.project_id=new.project_id) then
  raise exception '授課老師未被指派到此專案' using errcode='42501'; end if;
 if exists(select 1 from public.v5_team_students s
  where s.id=new.student_id and s.team_id=new.team_id and s.is_archived) then
  raise exception '已封存學生不可新增課程' using errcode='23514'; end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_team_lesson_assignment_guard()
 from public,anon,authenticated;
create trigger v5_team_lesson_assignment_guard before insert on
 public.v5_team_lessons for each row
 execute function tutor_private.v5_team_lesson_assignment_guard();

create policy v5_team_lesson_manager_or_assigned_select
 on public.v5_team_lessons for select to authenticated using(
 exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
    on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_lessons.team_id
   and g.manager_user_id=(select auth.uid()))
 or exists(select 1 from public.v5_team_project_members pm
  join public.v5_team_roster r
    on r.workspace_id=pm.workspace_id and r.user_id=pm.user_id
  where pm.project_id=public.v5_team_lessons.project_id
   and pm.user_id=(select auth.uid()))
);
create policy v5_team_lesson_teacher_or_manager_insert
 on public.v5_team_lessons for insert to authenticated with check(
 (teacher_user_id=(select auth.uid()) or exists(
  select 1 from public.v5_teams t
  join public.v5_team_governance g on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_lessons.team_id
    and g.manager_user_id=(select auth.uid())))
 and exists(select 1 from public.v5_team_project_members pm
   join public.v5_team_roster r
    on r.workspace_id=pm.workspace_id and r.user_id=pm.user_id
   where pm.project_id=public.v5_team_lessons.project_id
     and pm.user_id=public.v5_team_lessons.teacher_user_id)
);
create policy v5_team_lesson_teacher_or_manager_update
 on public.v5_team_lessons for update to authenticated using(
 (teacher_user_id=(select auth.uid()) and exists(
   select 1 from public.v5_team_project_members pm
   join public.v5_team_roster r
    on r.workspace_id=pm.workspace_id and r.user_id=pm.user_id
   where pm.project_id=public.v5_team_lessons.project_id
    and pm.user_id=(select auth.uid())))
 or exists(select 1 from public.v5_teams t
  join public.v5_team_governance g
   on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_lessons.team_id
   and g.manager_user_id=(select auth.uid()))
) with check(
 (teacher_user_id=(select auth.uid()) and exists(
   select 1 from public.v5_team_project_members pm
   join public.v5_team_roster r
    on r.workspace_id=pm.workspace_id and r.user_id=pm.user_id
   where pm.project_id=public.v5_team_lessons.project_id
    and pm.user_id=(select auth.uid())))
 or exists(select 1 from public.v5_teams t
  join public.v5_team_governance g on g.workspace_id=t.anchor_workspace_id
  where t.id=public.v5_team_lessons.team_id
   and g.manager_user_id=(select auth.uid()))
);
