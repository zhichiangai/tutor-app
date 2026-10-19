-- V2.7 read-only tenant/RLS security assertions. No production data writes.
do $audit$
declare t text; n int;
begin
 if (select count(*) from information_schema.columns where table_schema='public' and column_name='workspace_id'
 and is_nullable='NO' and table_name in ('students','lesson_records','guardian_invites',
 'student_guardians','family_requests','recurring_schedules','schedule_exceptions','payment_batches','payment_batch_items'))<>9
 then raise exception 'Workspace relation not present and mandatory on all business tables'; end if;
 if (select count(*) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
 where ns.nspname='public' and c.relkind='r' and not c.relrowsecurity)>0
 then raise exception 'Public table has RLS disabled'; end if;
 if has_table_privilege('anon','public.workspaces','SELECT')
  or has_table_privilege('authenticated','public.workspace_members','INSERT')
  or has_table_privilege('authenticated','public.workspace_members','UPDATE')
  or has_column_privilege('authenticated','public.workspaces','owner_id','UPDATE')
 then raise exception 'Unsafe public tenant management grants'; end if;
 if (select count(*) from public.workspace_members m join public.workspaces w
   on w.id=m.workspace_id where m.role='owner' and m.user_id<>w.owner_id)>0
 then raise exception 'Wrong owner membership'; end if;
 if (select count(*) from public.students s left join public.workspaces w
   on w.id=s.workspace_id where w.owner_id is distinct from s.teacher_id)>0
 then raise exception 'Student has wrong workspace'; end if;
 if (select count(*) from public.lesson_records l left join public.workspaces w
   on w.id=l.workspace_id where w.owner_id is distinct from l.owner_id)>0
 then raise exception 'Lesson has wrong workspace'; end if;
 if (select count(*) from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   join public.lesson_records l on l.id=i.lesson_id
   where i.workspace_id<>b.workspace_id or i.workspace_id<>l.workspace_id)>0
 then raise exception 'Payment allocation crosses workspace'; end if;
 if not exists (select 1 from pg_trigger where tgrelid='public.workspaces'::regclass
  and tgname='trg_create_owner_membership' and tgenabled='O') then
  raise exception 'Owner membership trigger is disabled'; end if;
 for t in select unnest(array['students','lesson_records','guardian_invites','student_guardians',
 'family_requests','recurring_schedules','schedule_exceptions','payment_batches','payment_batch_items'])
 loop
  if not exists(select 1 from pg_trigger where tgrelid=format('public.%I',t)::regclass
    and tgname='trg_assign_workspace' and tgenabled='O') then
   raise exception 'Workspace assignment trigger missing on %',t; end if;
 end loop;
end $audit$;
select 'V2.7 tenant assertions passed; no live records changed' as result;