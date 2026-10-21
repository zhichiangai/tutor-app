-- Run ONLY within BEGIN ... ROLLBACK, after loading V3.5.2 migration.
-- Fake auth users / course rows are created inside the same transaction.
do $fixture$
declare
 t uuid:=gen_random_uuid();g uuid:=gen_random_uuid();
 w uuid;s uuid;l uuid;l2 uuid;lp uuid;lb uuid;b uuid;
 before_rev timestamptz; rejected boolean;
begin
 insert into auth.users(id,email,aud,role,created_at,updated_at)
 values(t,'v352-teacher-'||left(t::text,8)||'@example.test','authenticated','authenticated',now(),now()),
       (g,'v352-guardian-'||left(g::text,8)||'@example.test','authenticated','authenticated',now(),now());
 insert into public.workspaces(owner_id,name) values(t,'V352 ROLLBACK finance tests') returning id into w;
 insert into public.students(teacher_id,name,subject,hourly_rate,workspace_id)
 values(t,'V352 only fixture','數學',500,w) returning id into s;
 insert into public.lesson_records(owner_id,student_id,workspace_id,student,lesson_date,subject,
  start_time,end_time,hours,hourly_rate,total_amount,type,status,received_date)
 values(t,s,w,'V352 only fixture',current_date-12,'數學','17:00','19:00',2,500,1000,
  'lesson','老師已收到',current_date-11) returning id into l;
 insert into public.lesson_records(owner_id,student_id,workspace_id,student,lesson_date,subject,
  start_time,end_time,hours,hourly_rate,total_amount,type,status)
 values(t,s,w,'V352 only fixture',current_date-11,'數學','17:00','19:00',2,500,1000,
  'lesson','家長已付款') returning id into l2;
 insert into public.lesson_records(owner_id,student_id,workspace_id,student,lesson_date,subject,
  start_time,end_time,hours,hourly_rate,total_amount,type,status)
 values(t,s,w,'V352 only fixture',current_date-10,'數學','17:00','19:00',2,500,1000,
  'lesson','未付款') returning id into lp;
 insert into public.family_requests(teacher_id,student_id,parent_id,lesson_id,kind,status,workspace_id)
 values(t,s,g,lp,'payment','pending',w);
 insert into public.lesson_records(owner_id,student_id,workspace_id,student,lesson_date,subject,
  start_time,end_time,hours,hourly_rate,total_amount,type,status)
 values(t,s,w,'V352 only fixture',current_date-9,'數學','17:00','19:00',2,500,1000,
  'lesson','未付款') returning id into lb;
 insert into public.payment_batches(teacher_id,student_id,parent_id,period_start,period_end,paid_on,
  paid_amount,status,workspace_id)
 values(t,s,g,current_date-9,current_date-9,current_date-9,250,'pending',w)
 returning id into b;
 insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount,workspace_id)
 values(b,lb,250,w);

 -- Simulate an authenticated teacher, including direct UPDATE under RLS.
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',t::text,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 rejected:=false;
 begin
  update public.lesson_records set status='未付款' where id=l;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: status-first legacy unlock succeeded'; end if;
 rejected:=false;
 begin
  update public.lesson_records set hours=3,total_amount=1500 where id=l;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: old receipt amount modified'; end if;
 if not exists(select 1 from public.lesson_records where id=l
   and status='老師已收到' and hours=2 and total_amount=1000)
 then raise exception 'FAILED: two-step attempt changed legacy paid row';end if;
 rejected:=false;
 begin
  update public.lesson_records set status='未付款' where id=l2;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: parent-paid status unlocked directly';end if;
 -- Parent-paid to teacher-received is a normal forward progression.
 update public.lesson_records set status='老師已收到' where id=l2;
 if not exists(select 1 from public.lesson_records where id=l2 and status='老師已收到')
 then raise exception 'FAILED: lawful receipt acknowledgment was blocked';end if;
 rejected:=false;
 begin
  update public.lesson_records set hours=3,total_amount=1500 where id=lp;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: pending payment request did not guard billable hours';end if;
 -- Original teacher approval of an old family payment request must still work.
 perform public.review_family_request(
  (select id from public.family_requests where lesson_id=lp and kind='payment'),true);
 if not exists(select 1 from public.lesson_records where id=lp and status='家長已付款')
 then raise exception 'FAILED: old family payment approval regressed';end if;
 rejected:=false;
 begin
  update public.lesson_records set status='未付款' where id=lp;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: approved family payment could be downgraded';end if;
 rejected:=false;
 begin
  update public.lesson_records set hours=3,total_amount=1500 where id=lb;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: allocated pending batch did not guard billable hours';end if;
 -- Confirm an actual partial batch (250/1000), then verify allocation guard survives.
 perform public.review_range_payment(b,true,current_date-9);
 if not exists(select 1 from public.payment_batches where id=b and status='confirmed')
 then raise exception 'FAILED: normal partial payment confirmation regressed';end if;
 rejected:=false;
 begin
  update public.lesson_records set hours=3,total_amount=1500 where id=lb;
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: confirmed batch did not guard billable hours';end if;
 select updated_at into before_rev from public.lesson_records where id=l;
 perform public.reverse_legacy_lesson_receipt(l,before_rev,'老師確認前一筆收款登錄有誤，撤銷以重新對帳');
 if not exists(select 1 from public.lesson_records where id=l
  and status='未付款' and received_date is null and hours=2 and total_amount=1000)
 then raise exception 'FAILED: authorized reversal did not preserve amounts';end if;
 rejected:=false;
 begin
  perform public.reverse_legacy_lesson_receipt(l,before_rev,'repeated unauthorized reversal attempt');
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: reversal repeated';end if;
 -- The private audit is readable by postgres only, never by authenticated.
 execute 'reset role';
 if not exists(select 1 from tutor_private.legacy_receipt_reversal_audit a
  where a.lesson_id=l and a.actor_id=t and a.applied
    and a.previous_status='老師已收到' and length(a.reason)>=10
    and a.previous_hours=2 and a.previous_hourly_rate=500
    and a.previous_total_amount=1000)
 then raise exception 'FAILED: no applied audit of authorized reversal';end if;
 execute 'set local role authenticated';
 -- The teacher may correct billable hours only *after* the controlled reversal.
 update public.lesson_records set hours=3,total_amount=1500 where id=l;
 if not exists(select 1 from public.lesson_records where id=l
   and hours=3 and total_amount=1500 and status='未付款')
 then raise exception 'FAILED: authorized reversal did not reopen correction path';end if;
 -- A paid lesson may still receive academic notes and star ratings.
 update public.lesson_records set lesson_content='v352 日誌更新',focus_rating=4,mood_rating=5
 where id=l2;
 if not exists(select 1 from public.lesson_records where id=l2
  and lesson_content='v352 日誌更新' and focus_rating=4 and mood_rating=5)
 then raise exception 'FAILED: paid feedback incorrectly locked';end if;

 perform set_config('request.jwt.claim.sub',g::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',g::text,'role','authenticated')::text,true);
 rejected:=false;
 begin
  perform public.reverse_legacy_lesson_receipt(l2,
    (select updated_at from public.lesson_records where id=l2),
    '未授權家長嘗試撤銷老師的收款紀錄');
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: non-owner reversed receipt';end if;

 -- A linked payment request or batch cannot use the legacy-only reversal path.
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',t::text,'role','authenticated')::text,true);
 rejected:=false;
 begin
  perform public.reverse_legacy_lesson_receipt(lp,
   (select updated_at from public.lesson_records where id=lp),'禁止繞過既有付款申請');
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAILED: non-paid pending request could reverse';end if;
end;$fixture$;
