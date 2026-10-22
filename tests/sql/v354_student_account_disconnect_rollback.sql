-- Run ONLY after loading the V3.5.4 draft RPC inside BEGIN ... ROLLBACK.
-- All auth users, invitations, linked student and lesson are temporary fixture rows.
do $fixture$
declare
  teacher uuid := gen_random_uuid();
  other_teacher uuid := gen_random_uuid();
  student_user uuid := gen_random_uuid();
  w uuid; student_id uuid; modern uuid; legacy uuid; linked uuid; lesson_id uuid;
  pending uuid; refused boolean;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at)
  values(teacher,'v354-teacher-'||left(teacher::text,8)||'@example.test','authenticated','authenticated',now(),now()),
    (other_teacher,'v354-other-'||left(other_teacher::text,8)||'@example.test','authenticated','authenticated',now(),now()),
    (student_user,'v354-student-'||left(student_user::text,8)||'@example.test','authenticated','authenticated',now(),now());
  insert into public.workspaces(owner_id,name)
    values(teacher,'V354 ROLLBACK student management') returning id into w;
  insert into public.students(teacher_id,name,subject,hourly_rate,workspace_id)
    values(teacher,'V354 ROLLBACK STUDENT','數學',500,w) returning id into student_id;
  insert into public.student_invites(teacher_id,student_id,email)
    values(teacher,student_id,'v354-student-'||left(student_user::text,8)||'@example.test')
    returning id into modern;
  insert into public.student_invitations(teacher_id,student_id,email)
    values(teacher,student_id,'v354-student-'||left(student_user::text,8)||'@example.test')
    returning id into legacy;
  insert into public.student_links(invitation_id,teacher_id,student_id,user_id)
    values(legacy,teacher,student_id,student_user) returning id into linked;
  insert into public.lesson_records(owner_id,student_id,workspace_id,student,lesson_date,subject,
    start_time,end_time,hours,hourly_rate,total_amount,type,status)
    values(teacher,student_id,w,'V354 ROLLBACK STUDENT',current_date,'數學','17:00','18:00',
      1,500,500,'lesson','未付款') returning id into lesson_id;

  perform set_config('request.jwt.claim.sub',other_teacher::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',other_teacher::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  refused:=false;
  begin
    perform public.revoke_student_account_connection(student_id,
      'v354-student-'||left(student_user::text,8)||'@example.test');
  exception when others then refused:=true;end;
  if not refused then raise exception 'FAILED: unrelated teacher revoked another student account';end if;

  perform set_config('request.jwt.claim.sub',teacher::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',teacher::text,'role','authenticated')::text,true);
  perform public.revoke_student_account_connection(student_id,
      'V354-STUDENT-'||left(student_user::text,8)||'@EXAMPLE.TEST');
  if exists(select 1 from public.student_invites where id=modern)
    or exists(select 1 from public.student_invitations where id=legacy)
    or exists(select 1 from public.student_links where id=linked)
  then raise exception 'FAILED: accepted student access or an invitation survived revocation';end if;
  if not exists(select 1 from public.lesson_records where id=lesson_id
    and total_amount=500 and status='未付款')
  then raise exception 'FAILED: account disconnection modified historical lesson';end if;
  if not exists(select 1 from public.students where id=student_id and hourly_rate=500)
  then raise exception 'FAILED: account disconnection modified student record';end if;
  refused:=false;
  begin
    perform public.revoke_student_account_connection(student_id,
      'v354-student-'||left(student_user::text,8)||'@example.test');
  exception when others then refused:=true;end;
  if not refused then raise exception 'FAILED: repeated revoked invitation was not rejected';end if;

  insert into public.student_invites(teacher_id,student_id,email)
    values(teacher,student_id,'v354-pending-'||left(student_user::text,8)||'@example.test')
    returning id into pending;
  perform public.revoke_student_account_connection(student_id,
    'v354-pending-'||left(student_user::text,8)||'@example.test');
  if exists(select 1 from public.student_invites where id=pending)
  then raise exception 'FAILED: pending student invitation could not be cancelled';end if;

  -- A teacher can update only the student's defaults without changing past amounts.
  update public.students set name='V354 EDITED',subject='理化',hourly_rate=650
    where id=student_id and teacher_id=teacher;
  if not exists(select 1 from public.students where id=student_id and name='V354 EDITED' and hourly_rate=650)
    or not exists(select 1 from public.lesson_records where id=lesson_id and hourly_rate=500 and total_amount=500)
  then raise exception 'FAILED: default rate update unexpectedly changed past lessons';end if;
end;
$fixture$;
reset role;
do $grants$
begin
 if has_function_privilege('anon','public.revoke_student_account_connection(uuid,text)','EXECUTE')
 then raise exception 'FAILED: anon may revoke a student account';end if;
 if not has_function_privilege('authenticated','public.revoke_student_account_connection(uuid,text)','EXECUTE')
 then raise exception 'FAILED: authenticated teacher lacks controlled revoke RPC';end if;
 if (select prosecdef from pg_proc where oid='public.revoke_student_account_connection(uuid,text)'::regprocedure)
 then raise exception 'FAILED: disconnect RPC must not bypass caller RLS';end if;
end;$grants$;
