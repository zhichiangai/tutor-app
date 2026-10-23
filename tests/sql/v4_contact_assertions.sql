-- Synthetic PostgreSQL role test; real local Supabase Auth JWT still required.
\set ON_ERROR_STOP on
begin;
set local role anon;
select public.qa_expect_error(
 'select public.v4_contact_inbox()','anon cannot list contacts');
select public.qa_expect_error(
 'select public.v4_contact_request(''parent1@example.test'',''teacher'')','anon cannot invite');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.qa_expect_error(
 'select * from public.v4_account_contacts','browser cannot query contact table');
select public.qa_expect_error(
 'select public.v4_contact_request(''parent1@example.test'',null)','null role rejected');
select public.v4_contact_request('parent1@example.test','teacher');
reset role;
select id as contact_id from public.v4_account_contacts
 where teacher_id='00000000-0000-4000-8000-000000000001'
   and parent_id='00000000-0000-4000-8000-000000000003' \gset
select public.qa_assert((select count(*)=1 from public.v4_account_contacts),'contact invitation created without student');
select public.qa_assert((select count(*)=0 from public.student_guardians),'contact link has no guardian grants');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.qa_expect_error(
 format('select public.v4_contact_action(%L,''approve'')',:'contact_id'),
 'inviter cannot self-approve');
select public.qa_expect_error(
 format('select public.v4_contact_action(%L,null)',:'contact_id'),
 'null action rejected');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.qa_expect_error(
 format('select public.v4_contact_action(%L,''approve'')',:'contact_id'),
 'other teacher cannot approve');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.qa_assert(pg_catalog.jsonb_array_length(public.v4_contact_inbox())=1,'invitee sees pending invitation');
select public.v4_contact_action(:'contact_id','approve');
select public.qa_assert((public.v4_contact_inbox()->0->>'status')='connected','invitee accepted contact');
select public.qa_expect_error(
 format('select public.v4_contact_action(%L,''approve'')',:'contact_id'),
 'approval cannot replay');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.v4_contact_request('parent1@example.test','teacher');
reset role;
select public.qa_assert((select count(*)=1 from public.v4_account_contacts),'duplicate active invite not created');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.v4_contact_action(:'contact_id','disconnect');
reset role;
select public.qa_assert((select count(*)=0 from public.student_guardians),'disconnection did not delete unrelated guardian history');
select public.qa_assert((select status='disconnected' from public.v4_account_contacts where id=:'contact_id'),'contact relationship history retained');
select public.qa_assert((select count(*)=0 from public.qa_course_snapshot where paid=false),'payment snapshot unchanged');
rollback;
