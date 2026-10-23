-- Disposable PostgreSQL contract fixture ONLY. Not a production baseline migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema tutor_private;
revoke all on schema tutor_private from public;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
create table auth.users(id uuid primary key,email text unique);
create table public.profiles(id uuid primary key references auth.users(id),display_name text);
create table public.workspaces(id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users(id));
create table public.students(id uuid primary key,teacher_id uuid references auth.users(id),name text);
create table public.guardian_invites(id uuid primary key default gen_random_uuid(),teacher_id uuid references auth.users(id),student_id uuid references public.students(id),email text,
 unique(teacher_id,student_id,email));
create table public.student_guardians(id uuid primary key default gen_random_uuid(),invite_id uuid references public.guardian_invites(id) on delete cascade,
 teacher_id uuid references auth.users(id),student_id uuid references public.students(id),guardian_id uuid references auth.users(id),unique(invite_id,guardian_id));
create table public.qa_course_snapshot(id integer primary key,student_id uuid,hours numeric,amount numeric,paid boolean);
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001','teacher1@example.test'),
 ('00000000-0000-4000-8000-000000000002','teacher2@example.test'),
 ('00000000-0000-4000-8000-000000000003','parent1@example.test'),
 ('00000000-0000-4000-8000-000000000004','parent2@example.test');
insert into public.profiles select id,'QA actor' from auth.users;
insert into public.workspaces(owner_id) select id from auth.users where email like 'teacher%';
insert into public.students values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','QA child one'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','QA child two'),
 ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','QA child three');
insert into public.qa_course_snapshot values(1,'00000000-0000-4000-8000-000000000011',1.5,999,true);
create function public.qa_assert(p_ok boolean,p_label text) returns void language plpgsql as $$
 begin if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if; raise notice 'PASS: %',p_label; end; $$;
create function public.qa_expect_error(p_sql text,p_label text) returns void language plpgsql as $$
 declare failed boolean:=false;
 begin begin execute p_sql; exception when others then failed:=true; end;
 perform public.qa_assert(failed,p_label); end; $$;
