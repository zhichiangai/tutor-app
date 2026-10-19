-- V2.7 additive, single-owner workspace schema. Existing courses and payments remain intact.
-- Never store subscription state or enable team management in this version.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '使用者' check(char_length(display_name) between 1 and 80),
 created_at timestamptz not null default now()
);
create table if not exists public.workspaces (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null default '我的家教空間' check(char_length(name) between 1 and 80),
 kind text not null default 'individual' check(kind in ('individual','team')),
 created_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','admin','teacher')),
 created_at timestamptz not null default now(),
 primary key(workspace_id,user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id,workspace_id);

create or replace function tutor_private.create_workspace_owner_membership()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_members(workspace_id,user_id,role)
 values(new.id,new.owner_id,'owner');
 return new;
end $$;
revoke all on function tutor_private.create_workspace_owner_membership() from public,anon,authenticated;
drop trigger if exists trg_create_owner_membership on public.workspaces;
create trigger trg_create_owner_membership after insert on public.workspaces
for each row execute function tutor_private.create_workspace_owner_membership();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.profiles, public.workspaces, public.workspace_members from public,anon,authenticated;
grant select,insert on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select,insert on public.workspaces to authenticated;
grant update(name) on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;

create policy profile_self_read on public.profiles for select to authenticated
 using(id=(select auth.uid()));
create policy profile_self_create on public.profiles for insert to authenticated
 with check(id=(select auth.uid()));
create policy profile_self_update on public.profiles for update to authenticated
 using(id=(select auth.uid())) with check(id=(select auth.uid()));

create policy workspace_owner_or_invited_read on public.workspaces for select to authenticated
using (
 owner_id=(select auth.uid())
 or exists(select 1 from public.student_guardians g
     where g.teacher_id=workspaces.owner_id and g.guardian_id=(select auth.uid()))
 or exists(select 1 from public.guardian_invites i
     where i.teacher_id=workspaces.owner_id and
      lower(i.email)=lower(((select auth.jwt())->>'email')))
);
create policy workspace_self_create on public.workspaces for insert to authenticated
 with check(owner_id=(select auth.uid()) and kind='individual');
create policy workspace_owner_rename on public.workspaces for update to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and kind='individual');
create policy member_self_read on public.workspace_members for select to authenticated
 using(user_id=(select auth.uid()));

-- Backfill only teachers who already own records. Parent-only users are not converted into teachers.
insert into public.profiles(id,display_name)
 select id, left(coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),
                               nullif(trim(raw_user_meta_data->>'name'),''),'使用者'),80)
 from auth.users on conflict(id) do nothing;
with teachers as (
 select teacher_id id from public.students
 union select owner_id from public.lesson_records
 union select teacher_id from public.guardian_invites
 union select teacher_id from public.student_guardians
 union select teacher_id from public.family_requests
 union select teacher_id from public.recurring_schedules
 union select teacher_id from public.schedule_exceptions
 union select teacher_id from public.payment_batches
)
insert into public.workspaces(owner_id,name)
select distinct id,'我的家教空間' from teachers where id is not null
on conflict(owner_id) do nothing;

-- Workspace IDs are derived by the backend, not trusted from a browser payload.
alter table public.students add column if not exists workspace_id uuid;
alter table public.lesson_records add column if not exists workspace_id uuid;
alter table public.guardian_invites add column if not exists workspace_id uuid;
alter table public.student_guardians add column if not exists workspace_id uuid;
alter table public.family_requests add column if not exists workspace_id uuid;
alter table public.recurring_schedules add column if not exists workspace_id uuid;
alter table public.schedule_exceptions add column if not exists workspace_id uuid;
alter table public.payment_batches add column if not exists workspace_id uuid;
alter table public.payment_batch_items add column if not exists workspace_id uuid;

update public.students t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.lesson_records t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.owner_id and t.workspace_id is null;
update public.guardian_invites t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.student_guardians t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.family_requests t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.recurring_schedules t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.schedule_exceptions t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.payment_batches t set workspace_id=w.id from public.workspaces w
 where w.owner_id=t.teacher_id and t.workspace_id is null;
update public.payment_batch_items i set workspace_id=b.workspace_id
 from public.payment_batches b where i.batch_id=b.id and i.workspace_id is null;

create or replace function tutor_private.set_teacher_workspace_id()
returns trigger language plpgsql security definer set search_path='' as $$
declare assigned uuid; teacher uuid;
begin
 teacher := (to_jsonb(new)->>tg_argv[0])::uuid;
 select w.id into assigned from public.workspaces w where w.owner_id=teacher;
 if assigned is null then raise exception 'Teacher has no personal workspace'; end if;
 if new.workspace_id is not null and new.workspace_id<>assigned then
  raise exception 'Workspace does not belong to the assigned teacher';
 end if;
 new.workspace_id:=assigned;
 return new;
end $$;
revoke all on function tutor_private.set_teacher_workspace_id() from public,anon,authenticated;

create or replace function tutor_private.set_payment_item_workspace_id()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch_ws uuid; lesson_ws uuid;
begin
 select workspace_id into batch_ws from public.payment_batches where id=new.batch_id;
 select workspace_id into lesson_ws from public.lesson_records where id=new.lesson_id;
 if batch_ws is null or lesson_ws is null or batch_ws<>lesson_ws then
   raise exception 'Payment batch and lesson must belong to the same workspace';
 end if;
 if new.workspace_id is not null and new.workspace_id<>batch_ws then
   raise exception 'Cannot reassign payment item to another workspace';
 end if;
 new.workspace_id:=batch_ws;
 return new;
end $$;
revoke all on function tutor_private.set_payment_item_workspace_id() from public,anon,authenticated;

do $setup$
declare table_name text; owner_column text;
begin
 for table_name,owner_column in
 select * from (values
  ('students','teacher_id'),('lesson_records','owner_id'),
  ('guardian_invites','teacher_id'),('student_guardians','teacher_id'),
  ('family_requests','teacher_id'),('recurring_schedules','teacher_id'),
  ('schedule_exceptions','teacher_id'),('payment_batches','teacher_id')) as v(t,c)
 loop
  execute format('drop trigger if exists trg_assign_workspace on public.%I',table_name);
  execute format('create trigger trg_assign_workspace before insert or update on public.%I for each row execute function tutor_private.set_teacher_workspace_id(%L)',table_name,owner_column);
  execute format('alter table public.%I alter column workspace_id set not null',table_name);
  execute format('create index if not exists %I on public.%I(workspace_id)',
        table_name||'_workspace_idx',table_name);
 end loop;
end $setup$;
drop trigger if exists trg_assign_workspace on public.payment_batch_items;
create trigger trg_assign_workspace before insert or update on public.payment_batch_items
for each row execute function tutor_private.set_payment_item_workspace_id();
alter table public.payment_batch_items alter column workspace_id set not null;
create index if not exists payment_batch_items_workspace_idx on public.payment_batch_items(workspace_id);

-- All child records must resolve to their own workspace, never another teacher's.
alter table public.students add constraint students_workspace_fk
 foreign key(workspace_id) references public.workspaces(id);
alter table public.students add constraint students_id_workspace_unique unique(id,workspace_id);
alter table public.lesson_records add constraint lessons_workspace_fk
 foreign key(workspace_id) references public.workspaces(id);
alter table public.lesson_records add constraint lessons_id_workspace_unique unique(id,workspace_id);
alter table public.recurring_schedules add constraint recurring_workspace_fk
 foreign key(workspace_id) references public.workspaces(id);
alter table public.recurring_schedules add constraint recurring_id_workspace_unique unique(id,workspace_id);
alter table public.payment_batches add constraint batches_workspace_fk
 foreign key(workspace_id) references public.workspaces(id);
alter table public.payment_batches add constraint batches_id_workspace_unique unique(id,workspace_id);

alter table public.lesson_records add constraint lesson_student_same_workspace
 foreign key(student_id,workspace_id) references public.students(id,workspace_id);
alter table public.guardian_invites add constraint invite_student_same_workspace
 foreign key(student_id,workspace_id) references public.students(id,workspace_id);
alter table public.student_guardians add constraint guardian_student_same_workspace
 foreign key(student_id,workspace_id) references public.students(id,workspace_id);
alter table public.family_requests add constraint request_student_same_workspace
 foreign key(student_id,workspace_id) references public.students(id,workspace_id);
alter table public.family_requests add constraint request_lesson_same_workspace
 foreign key(lesson_id,workspace_id) references public.lesson_records(id,workspace_id);
alter table public.recurring_schedules add constraint recurring_student_same_workspace
 foreign key(student_id,workspace_id) references public.students(id,workspace_id);
alter table public.schedule_exceptions add constraint exception_schedule_same_workspace
 foreign key(schedule_id,workspace_id) references public.recurring_schedules(id,workspace_id);
alter table public.payment_batches add constraint batch_student_same_workspace
 foreign key(student_id,workspace_id) references public.students(id,workspace_id);
alter table public.payment_batch_items add constraint item_batch_same_workspace
 foreign key(batch_id,workspace_id) references public.payment_batches(id,workspace_id);
alter table public.payment_batch_items add constraint item_lesson_same_workspace
 foreign key(lesson_id,workspace_id) references public.lesson_records(id,workspace_id);
-- Guard internal schemas and avoid granting management or membership insertion to web clients.
revoke all on public.workspace_members from public,anon;
