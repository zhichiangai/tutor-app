-- V4.0 DRAFT: dual-initiated guardian/teacher requests and GAS notification queue.
-- DO NOT run against production until isolated staging tests and operator approval.
-- Separate migration from existing V3.5.9 payment/course schema.
create schema if not exists tutor_private;

create table if not exists public.v4_connection_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id),
  parent_id uuid not null references auth.users(id),
  student_id uuid references public.students(id),
  child_label text not null default '',
  origin text not null check (origin in ('parent_email','teacher_qr','parent_qr','teacher_link','parent_link')),
  status text not null default 'pending_teacher' check (status in ('pending_teacher','pending_parent','approved','declined','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  updated_at timestamptz not null default now(),
  constraint v4_distinct_parties check (teacher_id <> parent_id),
  constraint v4_child_label_length check (char_length(child_label) <= 80)
);
create index if not exists v4_requests_teacher_pending_idx on public.v4_connection_requests(teacher_id,status,created_at desc);
create index if not exists v4_requests_parent_pending_idx on public.v4_connection_requests(parent_id,status,created_at desc);
alter table public.v4_connection_requests enable row level security;
revoke all on public.v4_connection_requests from public,anon,authenticated;
-- All browser access goes through narrowly scoped RPCs. No client INSERT/UPDATE.

create table if not exists tutor_private.v4_invitation_links (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  side text not null check (side in ('teacher','parent')),
  student_id uuid references public.students(id),
  token_digest text unique not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check ((side='parent' and student_id is null) or (side='teacher' and student_id is not null))
);
alter table tutor_private.v4_invitation_links enable row level security;
revoke all on tutor_private.v4_invitation_links from public,anon,authenticated;

create table if not exists tutor_private.v4_email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check(status in ('queued','processing','sent','failed','uncertain')),
  attempts integer not null default 0,
  lease_token uuid,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table tutor_private.v4_email_outbox enable row level security;
revoke all on tutor_private.v4_email_outbox from public,anon,authenticated;

create table if not exists tutor_private.v4_rate_limits (
  actor_id uuid not null references auth.users(id), action text not null,
  bucket timestamptz not null, attempts integer not null,
  primary key(actor_id,action)
);
alter table tutor_private.v4_rate_limits enable row level security;
revoke all on tutor_private.v4_rate_limits from public,anon,authenticated;
create or replace function tutor_private.v4_limit(p_action text,p_max integer)
returns void language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=(select auth.uid()); v_n integer;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  insert into tutor_private.v4_rate_limits(actor_id,action,bucket,attempts)
  values(v_uid,p_action,date_trunc('hour',now()),1)
  on conflict(actor_id,action) do update set
    attempts=case when v4_rate_limits.bucket=date_trunc('hour',now()) then v4_rate_limits.attempts+1 else 1 end,
    bucket=date_trunc('hour',now()) returning attempts into v_n;
  if v_n>p_max then raise exception '操作太頻繁，請稍後再試'; end if;
end;
$$;
revoke all on function tutor_private.v4_limit(text,integer) from public,anon,authenticated;

create or replace function tutor_private.v4_enqueue(p_event_key text,p_recipient text,p_subject text,p_body text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if p_recipient is null or p_recipient !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  insert into tutor_private.v4_email_outbox(event_key,recipient,subject,body)
  values(p_event_key,lower(p_recipient),p_subject,p_body)
  on conflict(event_key) do nothing;
exception when others then
  raise warning 'V4 notification enqueue failed; relationship retained';
end;
$$;
revoke all on function tutor_private.v4_enqueue(text,text,text,text) from public,anon,authenticated;

-- The client receives an ordinary invitation URL containing a random, one-time token.
-- Only a SHA-256 fingerprint is stored; the token combines two random UUIDs.
-- This hash is for high-entropy token lookup, not for hashing human passwords.
create or replace function public.v4_create_connection_link(p_side text,p_student_id uuid default null,p_share boolean default false)
returns text language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  if p_side is null or p_side not in ('teacher','parent') then raise exception '無效的邀請方式'; end if;
  if p_side='teacher' and not exists (
    select 1 from public.students s where s.id=p_student_id and s.teacher_id=v_uid
  ) then raise exception '請選擇自己管理的學生'; end if;
  if p_side='parent' and p_student_id is not null then raise exception '此邀請不需要指定學生'; end if;
  perform tutor_private.v4_limit('create_link',15);
  if (select count(*) from tutor_private.v4_invitation_links
      where created_by=v_uid and created_at>now()-interval '1 hour')>=15
    then raise exception '邀請建立太頻繁，請稍後再試'; end if;
  v_token := replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into tutor_private.v4_invitation_links(created_by,side,student_id,token_digest,expires_at)
  values(v_uid,p_side,p_student_id,encode(sha256(convert_to(v_token,'UTF8')),'hex'),now() + (case when p_share then interval '7 days' else interval '10 minutes' end));
  return v_token;
end;
$$;
revoke all on function public.v4_create_connection_link(text,uuid,boolean) from public,anon;
grant execute on function public.v4_create_connection_link(text,uuid,boolean) to authenticated;

create or replace function public.v4_preview_connection_link(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_link record; v_name text;
begin
  if (select auth.uid()) is null then raise exception '請先登入'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into v_link from tutor_private.v4_invitation_links
   where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex') and used_at is null and expires_at>now();
  if not found then return null; end if;
  select coalesce(nullif(trim(display_name),''),'一位使用者') into v_name
   from public.profiles where id=v_link.created_by;
  return jsonb_build_object('side',v_link.side,'name',coalesce(v_name,'一位使用者'),'expires_at',v_link.expires_at);
end;
$$;
revoke all on function public.v4_preview_connection_link(text) from public,anon;
grant execute on function public.v4_preview_connection_link(text) to authenticated;

create or replace function public.v4_request_teacher(p_teacher_email text,p_child_label text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_teacher uuid; v_new uuid; v_my_email text;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  if coalesce(length(trim(p_child_label)),0) not between 1 and 80 then raise exception '請填寫孩子的稱呼'; end if;
  if p_teacher_email is null or p_teacher_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_teacher_email)>254
    then raise exception '請確認老師的 Email 格式'; end if;
  perform tutor_private.v4_limit('request_email',5);
  if (select count(*) from public.v4_connection_requests where parent_id=v_uid and created_at>now()-interval '1 hour')>=5
    then raise exception '申請太頻繁，請稍後再試'; end if;
  select u.id into v_teacher from auth.users u join public.workspaces w on w.owner_id=u.id
  where lower(u.email)=lower(trim(p_teacher_email)) and u.id<>v_uid limit 1;
  -- A generic success avoids disclosing whether this Email is registered.
  if v_teacher is null then return jsonb_build_object('submitted',true); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_teacher::text||v_uid::text,0));
  if exists (select 1 from public.v4_connection_requests
             where teacher_id=v_teacher and parent_id=v_uid and status='pending_teacher'
               and expires_at>now()) then
    return jsonb_build_object('submitted',true);
  end if;
  insert into public.v4_connection_requests(teacher_id,parent_id,child_label,origin)
  values(v_teacher,v_uid,trim(p_child_label),'parent_email') returning id into v_new;
  select email into v_my_email from auth.users where id=v_teacher;
  perform tutor_private.v4_enqueue(
    'v4:request:'||v_new::text,v_my_email,'好好上課｜有一筆新的家長連結申請',
    '您好，' || chr(10) || '有一位家長想與您連結課程。登入好好上課後，在「學生管理」確認就可以了。'||chr(10)||
    'https://tutor.rapid4grad.com/');
  return jsonb_build_object('submitted',true);
end;
$$;
revoke all on function public.v4_request_teacher(text,text) from public,anon;
grant execute on function public.v4_request_teacher(text,text) to authenticated;

create or replace function public.v4_claim_connection_link(p_token text,p_child_label text default '',p_student_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_link record; v_parent uuid; v_teacher uuid; v_student uuid; v_origin text; v_status text; v_id uuid; v_email text;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '邀請連結無效'; end if;
  perform tutor_private.v4_limit('claim_link',15);
  select * into v_link from tutor_private.v4_invitation_links
  where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or v_link.used_at is not null or v_link.expires_at<=now()
    then raise exception '邀請連結已使用或過期'; end if;
  if v_link.created_by=v_uid then raise exception '不能接受自己建立的邀請'; end if;
  if v_link.side='teacher' then
    if coalesce(length(trim(p_child_label)),0) not between 1 and 80 then raise exception '請填寫孩子的稱呼'; end if;
    v_teacher:=v_link.created_by; v_parent:=v_uid; v_student:=v_link.student_id;
    v_origin:='teacher_link'; v_status:='pending_teacher';
  else
    if p_student_id is null or not exists (
       select 1 from public.students where id=p_student_id and teacher_id=v_uid)
       then raise exception '請選擇自己管理的學生'; end if;
    v_teacher:=v_uid; v_parent:=v_link.created_by; v_student:=p_student_id;
    v_origin:='parent_link'; v_status:='pending_parent';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_teacher::text||v_parent::text,0));
  if exists(select 1 from public.v4_connection_requests
    where teacher_id=v_teacher and parent_id=v_parent and student_id=v_student
    and status in ('pending_teacher','pending_parent') and expires_at>now())
    then raise exception '已有一筆申請等待確認，請先處理原申請'; end if;
  update tutor_private.v4_invitation_links set used_at=now() where id=v_link.id;
  insert into public.v4_connection_requests(teacher_id,parent_id,student_id,child_label,origin,status)
  values(v_teacher,v_parent,v_student,trim(p_child_label),v_origin,v_status) returning id into v_id;
  select email into v_email from auth.users where id=case when v_status='pending_parent' then v_parent else v_teacher end;
  perform tutor_private.v4_enqueue('v4:claim:'||v_id::text,v_email,'好好上課｜有一筆連結申請等你確認',
    '您好，' || chr(10) || '有人透過邀請連結提出課程連結申請。登入好好上課確認就可以了。'||chr(10)||'https://tutor.rapid4grad.com/');
  return jsonb_build_object('id',v_id,'status',v_status);
end;
$$;
revoke all on function public.v4_claim_connection_link(text,text,uuid) from public,anon;
grant execute on function public.v4_claim_connection_link(text,text,uuid) to authenticated;

create or replace function public.v4_connection_inbox()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception '請先登入'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.id,'role',case when r.teacher_id=v_uid then 'teacher' else 'parent' end,
      'child_label',case when r.teacher_id=v_uid then r.child_label else '' end,
      'status',case when r.expires_at<=now() and r.status like 'pending%' then 'expired' else r.status end,
      'created_at',r.created_at,'student_id',case when r.teacher_id=v_uid then r.student_id else null end,
      'other_name',coalesce(nullif(trim(p.display_name),''),'一位使用者'),
      'origin',r.origin
    ) order by r.created_at desc)
    from public.v4_connection_requests r
    left join public.profiles p on p.id=case when r.teacher_id=v_uid then r.parent_id else r.teacher_id end
    where r.teacher_id=v_uid or r.parent_id=v_uid
    ),'[]'::jsonb);
end;
$$;
revoke all on function public.v4_connection_inbox() from public,anon;
grant execute on function public.v4_connection_inbox() to authenticated;

create or replace function public.v4_decide_connection_request(p_request_id uuid,p_approve boolean,p_student_id uuid default null)
returns text language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=(select auth.uid()); r public.v4_connection_requests%rowtype;
        v_student uuid; v_email text; v_invite uuid; v_linked boolean; v_teacher_email text; v_parent_email text;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  select * into r from public.v4_connection_requests where id=p_request_id for update;
  if not found then raise exception '找不到這筆申請'; end if;
  if r.status not in ('pending_teacher','pending_parent') or r.expires_at<=now()
    then raise exception '這筆申請已處理或過期'; end if;
  if (r.status='pending_teacher' and r.teacher_id<>v_uid)
     or (r.status='pending_parent' and r.parent_id<>v_uid)
    then raise exception '沒有處理這筆申請的權限'; end if;
  if p_approve is null then raise exception '請選擇確認或婉拒'; end if;
  if not p_approve then
    update public.v4_connection_requests set status='declined',updated_at=now() where id=p_request_id;
    perform tutor_private.v4_enqueue('v4:declined:'||r.id::text,
       (select email from auth.users where id=case when v_uid=r.teacher_id then r.parent_id else r.teacher_id end),
       '好好上課｜這筆連結申請未獲確認',
       '您好，'||chr(10)||'這筆課程連結申請沒有通過。若仍需要連結，可以直接與對方確認。'||chr(10)||'https://tutor.rapid4grad.com/');
    return 'declined';
  end if;
  v_student:=coalesce(r.student_id,p_student_id);
  if v_student is null or not exists(select 1 from public.students s
    where s.id=v_student and s.teacher_id=r.teacher_id)
    then raise exception '老師需確認要連結的學生'; end if;
  if r.student_id is not null and p_student_id is not null and r.student_id<>p_student_id
    then raise exception '不能變更原本同意的學生'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.teacher_id::text||r.parent_id::text,0));
  select lower(email) into v_parent_email from auth.users where id=r.parent_id;
  select lower(email) into v_teacher_email from auth.users where id=r.teacher_id;
  -- V4 sends its own approval notification, so suppress duplicate V3 legacy-trigger mail.
  perform set_config('tutor.v4_managed','true',true);
  if v_parent_email is null then raise exception '找不到家長帳號'; end if;
  select id into v_invite from public.guardian_invites
     where teacher_id=r.teacher_id and student_id=v_student and email=v_parent_email limit 1;
  if v_invite is null then
    insert into public.guardian_invites(teacher_id,student_id,email)
       values(r.teacher_id,v_student,v_parent_email) returning id into v_invite;
  end if;
  select exists(select 1 from public.student_guardians where invite_id=v_invite and guardian_id=r.parent_id) into v_linked;
  if not v_linked then
    insert into public.student_guardians(invite_id,teacher_id,student_id,guardian_id)
      values(v_invite,r.teacher_id,v_student,r.parent_id);
  end if;
  perform set_config('tutor.v4_managed','false',true);
  update public.v4_connection_requests set status='approved',student_id=v_student,updated_at=now() where id=p_request_id;
  perform tutor_private.v4_enqueue('v4:approved:parent:'||r.id::text,v_parent_email,'好好上課｜課程連結已完成',
    '您好，' || chr(10) || '老師與家長的課程連結已完成。登入好好上課就可以查看安排。'||chr(10)||'https://tutor.rapid4grad.com/');
  perform tutor_private.v4_enqueue('v4:approved:teacher:'||r.id::text,v_teacher_email,'好好上課｜課程連結已完成',
    '您好，' || chr(10) || '家長已與課程連結。登入好好上課就可以繼續管理。'||chr(10)||'https://tutor.rapid4grad.com/');
  return 'approved';
end;
$$;
revoke all on function public.v4_decide_connection_request(uuid,boolean,uuid) from public,anon;
grant execute on function public.v4_decide_connection_request(uuid,boolean,uuid) to authenticated;

create or replace function public.v4_cancel_connection_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=(select auth.uid()); v_request record;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  select * into v_request from public.v4_connection_requests where id=p_request_id for update;
  if not found or v_request.status not in ('pending_teacher','pending_parent')
    or v_request.expires_at<=now()
    or v_uid not in (v_request.parent_id,v_request.teacher_id)
    or (v_request.status='pending_teacher' and v_uid<>v_request.parent_id)
    or (v_request.status='pending_parent' and v_uid<>v_request.teacher_id)
    then raise exception '這筆申請無法撤回'; end if;
  update public.v4_connection_requests set status='cancelled',updated_at=now() where id=p_request_id;
  perform tutor_private.v4_enqueue('v4:cancelled:'||p_request_id::text,
     (select email from auth.users where id=case when v_uid=v_request.teacher_id then v_request.parent_id else v_request.teacher_id end),
     '好好上課｜這筆連結申請已取消',
     '您好，'||chr(10)||'對方已取消這筆課程連結申請，不需要再處理。'||chr(10)||'https://tutor.rapid4grad.com/');
end;
$$;
revoke all on function public.v4_cancel_connection_request(uuid) from public,anon;
grant execute on function public.v4_cancel_connection_request(uuid) to authenticated;

-- Service-only queue. No blind redelivery after an expired lease or ambiguous send.
create or replace function public.v4_mail_claim(p_limit integer default 10)
returns table(id uuid,recipient text,subject text,body text,lease_token uuid)
language plpgsql security definer set search_path=''
as $$
begin
  update tutor_private.v4_email_outbox set status='uncertain',last_error='lease_expired_delivery_unknown'
    where status='processing' and locked_until<now();
  return query
   with claims as (
    select q.id from tutor_private.v4_email_outbox q
    where q.status='queued' and q.attempts<3
    order by q.created_at
    for update skip locked limit least(greatest(coalesce(p_limit,1),1),20)
   ), updated as (
    update tutor_private.v4_email_outbox q set status='processing',attempts=q.attempts+1,
       locked_until=now()+interval '10 minutes',lease_token=gen_random_uuid()
    from claims where q.id=claims.id
    returning q.id,q.recipient,q.subject,q.body,q.lease_token
   )
   select updated.id,updated.recipient,updated.subject,updated.body,updated.lease_token from updated;
end;
$$;
revoke all on function public.v4_mail_claim(integer) from public,anon,authenticated;
grant execute on function public.v4_mail_claim(integer) to service_role;

create or replace function public.v4_mail_ack(p_id uuid,p_lease uuid,p_ok boolean,p_error text default '',p_uncertain boolean default false)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if p_ok is null or p_uncertain is null or p_lease is null then raise exception 'Invalid ACK'; end if;
 update tutor_private.v4_email_outbox set
  status=case when p_ok then 'sent' when p_uncertain then 'uncertain' when attempts>=3 then 'failed' else 'queued' end,
  sent_at=case when p_ok then now() else sent_at end,
  locked_until=null,last_error=case when p_ok then null else left(p_error,500) end
 where id=p_id and lease_token=p_lease and status in ('processing','uncertain');
 if not found and not exists(select 1 from tutor_private.v4_email_outbox
   where id=p_id and lease_token=p_lease and status='sent' and p_ok)
   then raise exception 'ACK lease mismatch'; end if;
end;
$$;
revoke all on function public.v4_mail_ack(uuid,uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.v4_mail_ack(uuid,uuid,boolean,text,boolean) to service_role;

-- Operators must inspect Gmail/worker journal first. Never automatically reset attempts.
create or replace function public.v4_mail_retry(p_id uuid,p_confirm_no_delivery boolean)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if p_confirm_no_delivery is distinct from true then raise exception 'Confirm no delivery before retry'; end if;
 update tutor_private.v4_email_outbox set status='queued',locked_until=null,lease_token=null,last_error='operator_verified_no_delivery'
 where id=p_id and status='uncertain' and attempts<3;
 if not found then raise exception 'Not eligible for retry'; end if;
end;
$$;
revoke all on function public.v4_mail_retry(uuid,boolean) from public,anon,authenticated;
grant execute on function public.v4_mail_retry(uuid,boolean) to service_role;

-- Notification hooks for the already-supported V3 teacher-initiated invites.
-- V4 approvals set a transaction-local flag to avoid sending duplicate emails.
create or replace function tutor_private.v4_notify_legacy_invitation()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_teacher_email text; v_parent_email text; v_parent_id uuid; v_student_label text;
begin
  if current_setting('tutor.v4_managed',true)='true' then return coalesce(new,old); end if;
  if tg_table_name='guardian_invites' and tg_op='INSERT' then
    perform tutor_private.v4_enqueue('v4:legacy-invite:'||new.id::text,new.email,
      '好好上課｜老師邀請您一起查看課程',
      '您好，'||chr(10)||'老師已邀請您一起查看孩子的課程。登入好好上課後，可以在「學生」頁面確認。'||chr(10)||
      'https://tutor.rapid4grad.com/');
  elsif tg_table_name='student_guardians' and tg_op='INSERT' then
    select email into v_teacher_email from auth.users where id=new.teacher_id;
    select email into v_parent_email from auth.users where id=new.guardian_id;
    perform tutor_private.v4_enqueue('v4:legacy-linked-teacher:'||new.id::text,v_teacher_email,
      '好好上課｜家長已完成課程連結',
      '您好，'||chr(10)||'家長已接受您的邀請，現在可以一起查看課程安排。'||chr(10)||'https://tutor.rapid4grad.com/');
    perform tutor_private.v4_enqueue('v4:legacy-linked-parent:'||new.id::text,v_parent_email,
      '好好上課｜課程連結已完成',
      '您好，'||chr(10)||'已經連結成功，可以登入好好上課查看課程安排。'||chr(10)||'https://tutor.rapid4grad.com/');
  elsif tg_table_name='guardian_invites' and tg_op='DELETE' then
    if exists(select 1 from public.student_guardians where invite_id=old.id) then
      select email into v_teacher_email from auth.users where id=old.teacher_id;
      perform tutor_private.v4_enqueue('v4:legacy-unlinked-parent:'||old.id::text,old.email,
        '好好上課｜課程連結已解除',
        '您好，'||chr(10)||'這筆課程連結已解除，之後將無法繼續查看該課程。過往課程和付款紀錄仍由原老師保留。');
      perform tutor_private.v4_enqueue('v4:legacy-unlinked-teacher:'||old.id::text,v_teacher_email,
        '好好上課｜家長課程連結已解除',
        '您好，'||chr(10)||'這位家長與課程的連結已解除。原本的上課與帳務資料仍會保留。');
    end if;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function tutor_private.v4_notify_legacy_invitation() from public,anon,authenticated;
drop trigger if exists v4_legacy_guardian_invite_created on public.guardian_invites;
create trigger v4_legacy_guardian_invite_created after insert on public.guardian_invites
for each row execute function tutor_private.v4_notify_legacy_invitation();
drop trigger if exists v4_legacy_guardian_invite_revoked on public.guardian_invites;
create trigger v4_legacy_guardian_invite_revoked before delete on public.guardian_invites
for each row execute function tutor_private.v4_notify_legacy_invitation();
drop trigger if exists v4_legacy_guardian_connected on public.student_guardians;
create trigger v4_legacy_guardian_connected after insert on public.student_guardians
for each row execute function tutor_private.v4_notify_legacy_invitation();

-- Guardian may leave the relationship without changing paid lesson history.
create or replace function public.v4_disconnect_guardian(p_student_guardian_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=(select auth.uid()); v_invite uuid;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  select g.invite_id into v_invite from public.student_guardians g
  where g.id=p_student_guardian_id and (g.guardian_id=v_uid or g.teacher_id=v_uid);
  if v_invite is null then raise exception '找不到可解除的課程連結'; end if;
  delete from public.guardian_invites where id=v_invite;
  if not found then raise exception '連結解除失敗'; end if;
end;
$$;
revoke all on function public.v4_disconnect_guardian(uuid) from public,anon;
grant execute on function public.v4_disconnect_guardian(uuid) to authenticated;
