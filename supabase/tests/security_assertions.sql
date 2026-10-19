-- Read-only security audit. Execute after applying the migrations.
do $audit$
declare v_table text;
begin
 if exists(select 1 from pg_policies where schemaname='public' and tablename='recurring_schedules'
    and policyname='no_fake_request_dates_only_valid_schedule') then
  raise exception 'Cross-tenant open schedule SELECT policy still exists';
 end if;
 if not exists(select 1 from pg_policies where schemaname='public'
    and tablename='recurring_schedules' and policyname='recurring_teacher_or_guardian_read') then
  raise exception 'Scoped recurring schedule SELECT policy missing';
 end if;
 if not exists(select 1 from pg_policies where schemaname='public'
    and tablename='student_guardians' and policyname='links_guardian_claim_invite'
    and with_check like '%student_guardians.student_id%'
    and with_check like '%student_guardians.teacher_id%') then
  raise exception 'Exact guardian invitation binding missing';
 end if;
 if not exists(select 1 from pg_policies where schemaname='public'
    and tablename='family_requests' and policyname='requests_guardian_create'
    and with_check like '%family_requests.student_id%') then
  raise exception 'Family request student constraint missing';
 end if;
 for v_table in select tablename from pg_tables where schemaname='public' loop
  if not (select relrowsecurity from pg_class where oid=format('%I.%I','public',v_table)::regclass) then
   raise exception 'RLS disabled on %',v_table;
  end if;
  if has_table_privilege('authenticated',format('public.%I',v_table),'TRUNCATE') then
   raise exception 'Browser role can TRUNCATE %',v_table;
  end if;
 end loop;
 if not has_column_privilege('authenticated','public.family_requests','status','UPDATE')
 or has_column_privilege('authenticated','public.family_requests','parent_id','UPDATE') then
  raise exception 'Family review UPDATE permissions are too broad or too narrow';
 end if;
 if not exists(select 1 from pg_trigger where tgname='trg_prevent_financial_lesson_delete'
    and tgrelid='public.lesson_records'::regclass and tgenabled='O') then
  raise exception 'Financial lesson delete protection missing';
 end if;
end $audit$;
select 'Security assertions passed; no production data modified' as audit_result;
