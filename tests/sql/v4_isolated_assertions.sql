-- PostgreSQL role simulation; NOT real OAuth JWT or full Supabase schema acceptance.
\set ON_ERROR_STOP on
begin;
set local role anon;
select public.qa_expect_error('select public.v4_connection_inbox()','anon cannot read inbox');
select public.qa_expect_error('select public.v4_mail_claim(1)','anon cannot claim mail');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.qa_expect_error('select * from public.v4_connection_requests','browser cannot read raw requests');
select public.qa_expect_error('select public.v4_mail_claim(1)','authenticated cannot claim mail');
select public.qa_expect_error($q$select public.v4_mail_set_app_url('https://staging.example.test/')$q$,'authenticated cannot change mail origin');
select public.qa_expect_error('select public.v4_mail_retry(gen_random_uuid(),true)','authenticated cannot retry mail');
select public.v4_request_teacher('teacher1@example.test','QA child');
select (public.v4_connection_inbox()->0->>'id') as req1 \gset
select public.qa_assert(jsonb_array_length(public.v4_connection_inbox())=1,'parent sees own pending request');
select public.v4_request_teacher('teacher1@example.test','QA child');
select public.qa_assert(jsonb_array_length(public.v4_connection_inbox())=1,'duplicate email request is idempotent');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.qa_assert(jsonb_array_length(public.v4_connection_inbox())=0,'other teacher sees no request');
select public.qa_expect_error(format('select public.v4_decide_connection_request(%L,true,%L)',:'req1','00000000-0000-4000-8000-000000000012'),'other teacher cannot approve');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.qa_expect_error(format('select public.v4_decide_connection_request(%L,true,%L)',:'req1','00000000-0000-4000-8000-000000000012'),'owner cannot choose another teachers child');
select public.qa_expect_error(format('select public.v4_decide_connection_request(%L,null,%L)',:'req1','00000000-0000-4000-8000-000000000011'),'null decision rejected');
select public.v4_decide_connection_request(:'req1',true,'00000000-0000-4000-8000-000000000011');
select public.qa_expect_error(format('select public.v4_decide_connection_request(%L,true,%L)',:'req1','00000000-0000-4000-8000-000000000011'),'approved request cannot replay');
-- Parent QR -> teacher claim -> parent approval; multiple parents on same child.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select public.v4_create_connection_link('parent') as parent_token \gset
select public.qa_assert((public.v4_preview_connection_link(:'parent_token')->>'side')='parent','parent QR preview has no child data');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.qa_expect_error(format('select public.v4_claim_connection_link(%L,%L,%L)',:'parent_token','','00000000-0000-4000-8000-000000000012'),'QR claim rejects foreign child');
select (public.v4_claim_connection_link(:'parent_token','','00000000-0000-4000-8000-000000000011')->>'id') as req2 \gset
select public.qa_expect_error(format('select public.v4_claim_connection_link(%L,%L,%L)',:'parent_token','','00000000-0000-4000-8000-000000000011'),'QR one-time token cannot replay');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select public.v4_decide_connection_request(:'req2',true);
reset role;
select public.qa_assert((select count(*)=2 from public.student_guardians where student_id='00000000-0000-4000-8000-000000000011'),'two parents can link one child');
select public.qa_assert((select token_digest<>:'parent_token' and length(token_digest)=64 from tutor_private.v4_invitation_links limit 1),'only SHA256 digest stored');
-- Teacher QR -> parent claim -> teacher approval.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.v4_create_connection_link('teacher','00000000-0000-4000-8000-000000000012',true) as teacher_token \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select (public.v4_claim_connection_link(:'teacher_token','QA second teacher')->>'id') as req3 \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.v4_decide_connection_request(:'req3',true,'00000000-0000-4000-8000-000000000012');
reset role;
select public.qa_assert((select count(distinct teacher_id)=2 from public.student_guardians where guardian_id='00000000-0000-4000-8000-000000000003'),'one parent can link two teachers');
select id as link1 from public.student_guardians where guardian_id='00000000-0000-4000-8000-000000000003' and teacher_id='00000000-0000-4000-8000-000000000001' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select public.qa_expect_error(format('select public.v4_disconnect_guardian(%L)',:'link1'),'other parent cannot disconnect a link');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.v4_disconnect_guardian(:'link1');
reset role;
select public.qa_assert(not exists(select 1 from public.student_guardians where id=:'link1'),'disconnect removes targeted permission row');
select public.qa_assert((select status='disconnected' from public.v4_connection_requests where id=:'req1'),'request history reflects disconnected permission');
select public.qa_assert((select count(*)=1 and bool_and(hours=1.5 and amount=999 and paid) from public.qa_course_snapshot),'synthetic paid course snapshot unchanged');
select public.qa_assert((select count(*)=3 from public.students),'no students deleted');
-- Cancellation and decline cannot later be accepted.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.v4_request_teacher('teacher1@example.test','QA cancel');
select item->>'id' as req4 from jsonb_array_elements(public.v4_connection_inbox()) item where item->>'status'='pending_teacher' \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.qa_expect_error(format('select public.v4_cancel_connection_request(%L)',:'req4'),'recipient declines rather than withdraws sender request');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.v4_cancel_connection_request(:'req4');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.qa_expect_error(format('select public.v4_decide_connection_request(%L,true,%L)',:'req4','00000000-0000-4000-8000-000000000011'),'cancelled request cannot approve');
-- Decline is final; unknown-address requests still consume the rate budget.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.v4_request_teacher('teacher1@example.test','QA decline');
select item->>'id' as decline_id from jsonb_array_elements(public.v4_connection_inbox()) item where item->>'status'='pending_teacher' \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.v4_decide_connection_request(:'decline_id',false);
select public.qa_expect_error(format('select public.v4_decide_connection_request(%L,true,%L)',:'decline_id','00000000-0000-4000-8000-000000000011'),'declined request cannot approve');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.v4_request_teacher('unknown@example.test','QA unknown');
select public.qa_expect_error($q$select public.v4_request_teacher('unknown2@example.test','QA unknown')$q$,'unknown email probes are rate limited');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- Expired token denied.
select public.v4_create_connection_link('teacher','00000000-0000-4000-8000-000000000011') as expired_token \gset
reset role;
update tutor_private.v4_invitation_links set expires_at=now()-interval '1 second' where token_digest=encode(sha256(convert_to(:'expired_token','UTF8')),'hex');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.qa_assert(public.v4_preview_connection_link(:'expired_token') is null,'expired preview is null');
select public.qa_expect_error(format('select public.v4_claim_connection_link(%L,%L)',:'expired_token','QA'),'expired token cannot claim');
reset role;
select public.qa_assert(not exists(select 1 from tutor_private.v4_email_outbox where body like '%https://tutor.rapid4grad.com/%'),'staging email never points to production');
set local role service_role;
select public.qa_expect_error($q$select public.v4_mail_set_app_url('https://tutor.rapid4grad.com/')$q$,'service cannot configure production origin in dev');
select public.v4_mail_set_app_url('https://staging.example.test/');
-- Claim and ACK lease behavior under actual PostgreSQL execution.
set local role service_role;
select * from public.v4_mail_claim(1) \gset mail_
select public.qa_expect_error(format('select public.v4_mail_ack(%L,gen_random_uuid(),true)',:'mail_id'),'stale ACK lease rejected');
select public.v4_mail_ack(:'mail_id',:'mail_lease_token',true);
select public.v4_mail_ack(:'mail_id',:'mail_lease_token',true);
reset role;
select public.qa_assert((select status='sent' from tutor_private.v4_email_outbox where id=:'mail_id'),'matching ACK is idempotent');
set local role service_role;
select * from public.v4_mail_claim(1) \gset lost_
reset role;
update tutor_private.v4_email_outbox set locked_until=now()-interval '1 second' where id=:'lost_id';
set local role service_role;
select count(*) from public.v4_mail_claim(1);
reset role;
select public.qa_assert((select status='uncertain' from tutor_private.v4_email_outbox where id=:'lost_id'),'expired processing is quarantined, not resent');
set local role service_role;
select public.qa_expect_error(format('select public.v4_mail_retry(%L,false)',:'lost_id'),'manual retry requires no-delivery confirmation');
select public.v4_mail_retry(:'lost_id',true);
reset role;
select public.qa_assert((select status='queued' and attempts=1 from tutor_private.v4_email_outbox where id=:'lost_id'),'manual retry keeps attempt count');
-- An outbox failure must not invalidate a legitimate relationship.
reset role;
alter table tutor_private.v4_email_outbox add constraint qa_block_outbox check(false) not valid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.v4_create_connection_link('teacher','00000000-0000-4000-8000-000000000013') as queue_fail_token \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select public.v4_claim_connection_link(:'queue_fail_token','QA outbox failure')->>'id' as queue_fail_request \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.v4_decide_connection_request(:'queue_fail_request',true,'00000000-0000-4000-8000-000000000013');
reset role;
select public.qa_assert(exists(select 1 from public.student_guardians where student_id='00000000-0000-4000-8000-000000000013'),'outbox failure preserves completed relationship');
rollback;
