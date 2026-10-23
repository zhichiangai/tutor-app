
create table if not exists public.students (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 80),
 subject text not null default '數學',
 hourly_rate numeric(12,2) not null default 500 check(hourly_rate >= 0),
 created_at timestamptz not null default now(),
 unique(id,teacher_id)
);
create index if not exists students_teacher_idx on public.students(teacher_id);

create table if not exists public.guardian_invites (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid not null,
 email text not null check(email = lower(trim(email))),
 created_at timestamptz not null default now(),
 constraint guardian_invites_student_owner_fk foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade,
 unique(student_id,email)
);
create index if not exists guardian_invites_email_idx on public.guardian_invites(email);

create table if not exists public.student_guardians (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid not null,
 guardian_id uuid not null references auth.users(id) on delete cascade,
 invite_id uuid not null references public.guardian_invites(id) on delete cascade,
 created_at timestamptz not null default now(),
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade,
 unique(student_id, guardian_id)
);
create index if not exists guardian_student_idx on public.student_guardians(guardian_id,student_id);

alter table public.lesson_records add column if not exists student_id uuid references public.students(id) on delete set null;
create index if not exists lesson_student_idx on public.lesson_records(student_id);

create table if not exists public.family_requests (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid not null,
 lesson_id uuid references public.lesson_records(id) on delete set null,
 parent_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('leave','payment')),
 status text not null default 'pending' check(status in ('pending','approved','declined')),
 note text not null default '',
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade
);
create index if not exists family_requests_teacher_idx on public.family_requests(teacher_id,status);
create index if not exists family_requests_parent_idx on public.family_requests(parent_id);

alter table public.students enable row level security;
alter table public.guardian_invites enable row level security;
alter table public.student_guardians enable row level security;
alter table public.family_requests enable row level security;

revoke all on public.students,public.guardian_invites,public.student_guardians,public.family_requests from anon;
grant select,insert,update,delete on public.students,public.guardian_invites,public.student_guardians,public.family_requests to authenticated;

create policy "students_teacher_and_guardian_read" on public.students for select to authenticated using (
 teacher_id=(select auth.uid()) or exists (
 select 1 from public.student_guardians sg where sg.student_id=students.id and sg.guardian_id=(select auth.uid())
 ));
create policy "students_teacher_insert" on public.students for insert to authenticated with check (teacher_id=(select auth.uid()));
create policy "students_teacher_update" on public.students for update to authenticated using (teacher_id=(select auth.uid())) with check(teacher_id=(select auth.uid()));
create policy "students_teacher_delete" on public.students for delete to authenticated using (teacher_id=(select auth.uid()));

create policy "invites_teacher_or_email_read" on public.guardian_invites for select to authenticated using (
 teacher_id=(select auth.uid()) or lower(email)=lower((select auth.jwt()->>'email'))
);
create policy "invites_teacher_insert" on public.guardian_invites for insert to authenticated with check (
 teacher_id=(select auth.uid()) and exists(select 1 from public.students s where s.id=student_id and s.teacher_id=(select auth.uid()))
);
create policy "invites_teacher_delete" on public.guardian_invites for delete to authenticated using (teacher_id=(select auth.uid()));

create policy "links_teacher_or_guardian_read" on public.student_guardians for select to authenticated using (
 teacher_id=(select auth.uid()) or guardian_id=(select auth.uid())
);
create policy "links_guardian_claim_invite" on public.student_guardians for insert to authenticated with check (
 guardian_id=(select auth.uid()) and exists (
 select 1 from public.guardian_invites i where i.id=invite_id and i.teacher_id=teacher_id and i.student_id=student_id
 and i.email=lower((select auth.jwt()->>'email'))
 )
);
create policy "links_teacher_or_guardian_remove" on public.student_guardians for delete to authenticated using (
 teacher_id=(select auth.uid()) or guardian_id=(select auth.uid())
);

create policy "guardian_view_own_lessons" on public.lesson_records for select to authenticated using (
 exists(select 1 from public.student_guardians sg where sg.student_id=lesson_records.student_id and sg.guardian_id=(select auth.uid()))
);

create policy "requests_teacher_or_parent_view" on public.family_requests for select to authenticated using (
 teacher_id=(select auth.uid()) or parent_id=(select auth.uid())
);
create policy "requests_guardian_create" on public.family_requests for insert to authenticated with check (
 parent_id=(select auth.uid()) and status='pending' and
 exists(select 1 from public.student_guardians sg where sg.student_id=family_requests.student_id and sg.teacher_id=family_requests.teacher_id and sg.guardian_id=(select auth.uid())) and
 (lesson_id is null or exists(select 1 from public.lesson_records lr where lr.id=lesson_id and lr.owner_id=teacher_id and lr.student_id=student_id))
);
create policy "requests_teacher_update" on public.family_requests for update to authenticated using (
 teacher_id=(select auth.uid())
) with check (teacher_id=(select auth.uid()));
