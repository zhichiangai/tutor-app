-- Disposable PostgreSQL fixture. Do NOT execute against any real Supabase project.
-- Fake auth.uid() reproduces current JWT sub for role-policy contract tests ONLY.
-- This does NOT replace real GoTrue authenticated JWT REST testing.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable set search_path=''
as $sql$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $sql$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;

create table public.lesson_records(
 id uuid primary key,
 owner_id uuid not null,
 student_id uuid not null,
 workspace_id uuid not null,
 type text not null,
 status text not null
);
create table public.payment_batches(
 id uuid primary key,
 teacher_id uuid not null,
 parent_id uuid not null,
 student_id uuid not null,
 workspace_id uuid not null,
 status text not null
);
create table public.payment_batch_items(
 batch_id uuid not null references public.payment_batches(id),
 lesson_id uuid not null references public.lesson_records(id),
 allocated_amount numeric(12,2) not null,
 primary key(batch_id,lesson_id)
);
create table public.student_guardians(
 id uuid primary key,
 teacher_id uuid not null,
 guardian_id uuid not null,
 student_id uuid not null,
 workspace_id uuid not null
);
grant select on public.lesson_records,public.payment_batches,
 public.payment_batch_items,public.student_guardians to authenticated;
-- Real V4 RLS permissions may differ. Fixture guards the same access dimensions.
alter table public.lesson_records enable row level security;
alter table public.payment_batches enable row level security;
alter table public.payment_batch_items enable row level security;
alter table public.student_guardians enable row level security;
create policy read_fixture_guardians on public.student_guardians for select to authenticated
using (guardian_id=(select auth.uid()) or teacher_id=(select auth.uid()));
create policy read_fixture_lessons on public.lesson_records for select to authenticated
using (owner_id=(select auth.uid()) or exists
 (select 1 from public.student_guardians g
  where g.student_id=lesson_records.student_id
    and g.teacher_id=lesson_records.owner_id
    and g.workspace_id=lesson_records.workspace_id
    and g.guardian_id=(select auth.uid())));
create policy read_fixture_batches on public.payment_batches for select to authenticated
using (teacher_id=(select auth.uid()) or
 (parent_id=(select auth.uid()) and exists
  (select 1 from public.student_guardians g
   where g.guardian_id=(select auth.uid())
     and g.teacher_id=payment_batches.teacher_id
     and g.student_id=payment_batches.student_id
     and g.workspace_id=payment_batches.workspace_id)));
create policy read_fixture_items on public.payment_batch_items for select to authenticated
using (exists (select 1 from public.payment_batches b
  where b.id=payment_batch_items.batch_id
    and (b.teacher_id=(select auth.uid()) or b.parent_id=(select auth.uid()))));
-- Fixed IDs: teacher A 1111, teacher B 2222, parent A 3333, parent B 4444, student 5555.
insert into auth.users(id) values
 ('11111111-1111-1111-1111-111111111111'),
 ('22222222-2222-2222-2222-222222222222'),
 ('33333333-3333-3333-3333-333333333333'),
 ('44444444-4444-4444-4444-444444444444'),
 ('55555555-5555-5555-5555-555555555555');
insert into public.lesson_records(id,owner_id,student_id,workspace_id,type,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','lesson','老師已收到'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','lesson','老師已收到'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','lesson','老師已收到'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4','22222222-2222-2222-2222-222222222222','88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999','lesson','老師已收到');
insert into public.payment_batches(id,teacher_id,parent_id,student_id,workspace_id,status) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','confirmed'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','confirmed'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','confirmed'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999','confirmed');
insert into public.payment_batch_items values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',400),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',600),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',1000),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',300);
insert into public.student_guardians values
 ('cccccccc-cccc-cccc-cccc-ccccccccccc1',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
