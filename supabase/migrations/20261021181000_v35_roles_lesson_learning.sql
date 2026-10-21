-- V3.5 core settings and teaching feedback
alter table public.profiles add column if not exists enabled_roles text[] not null default array['teacher']::text[];
alter table public.profiles add column if not exists roles_configured boolean not null default false;
alter table public.lesson_records add column if not exists lesson_content text;
alter table public.lesson_records add column if not exists mood_rating smallint;

-- An enabled UI mode is not an access grant. RLS continues to require links.
update public.profiles set enabled_roles=array[last_role]::text[]
 where last_role in ('teacher','parent','student')
   and enabled_roles=array['teacher']::text[] and last_role<>'teacher';
alter table public.profiles drop constraint if exists profiles_enabled_roles_valid;
alter table public.profiles add constraint profiles_enabled_roles_valid check(
 cardinality(enabled_roles) between 1 and 3
 and enabled_roles <@ array['teacher','parent','student']::text[]
 and array_position(enabled_roles,null) is null
);
alter table public.lesson_records drop constraint if exists lesson_mood_rating_valid;
alter table public.lesson_records add constraint lesson_mood_rating_valid
 check (mood_rating between 1 and 5);
alter table public.lesson_records drop constraint if exists lesson_content_length;
alter table public.lesson_records add constraint lesson_content_length
 check(length(coalesce(lesson_content,''))<=2000);

-- Only teacher's own completed lesson can have learning feedback updated.
-- SECURITY INVOKER: preserve ordinary lesson_records RLS.
create or replace function public.update_lesson_learning(
 p_lesson_id uuid, p_expected_updated_at timestamptz,
 p_lesson_content text,p_focus_rating smallint,p_mood_rating smallint,p_remarks text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid;v_rev timestamptz;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 if p_expected_updated_at is null then raise exception '缺少課程版本，請重新整理'; end if;
 if char_length(coalesce(p_lesson_content,''))>2000
  or char_length(coalesce(p_remarks,''))>2000 then
   raise exception '課程內容及課後備註最多 2000 字';
 end if;
 if (p_focus_rating is not null and p_focus_rating not between 1 and 5)
  or (p_mood_rating is not null and p_mood_rating not between 1 and 5)
 then raise exception '評分必須是 1 至 5 星'; end if;
 update public.lesson_records
 set lesson_content=nullif(btrim(coalesce(p_lesson_content,'')),''),
     focus_rating=p_focus_rating,mood_rating=p_mood_rating,
     remarks=nullif(btrim(coalesce(p_remarks,'')),'')
 where id=p_lesson_id and owner_id=auth.uid() and type='lesson'
   and updated_at=p_expected_updated_at
 returning id,updated_at into v_id,v_rev;
 if v_id is null then raise exception '找不到課程或課程已更新，請重新整理'; end if;
 return jsonb_build_object('id',v_id,'updated_at',v_rev);
end;$$;
revoke all on function public.update_lesson_learning(uuid,timestamptz,text,smallint,smallint,text)
 from public,anon;
grant execute on function public.update_lesson_learning(uuid,timestamptz,text,smallint,smallint,text)
 to authenticated;

-- Private audit history. No exposed table or new public read permissions.
create table if not exists tutor_private.lesson_feedback_audit (
 id bigserial primary key,lesson_id uuid not null,actor_id uuid,
 edited_at timestamptz not null default clock_timestamp(),
 previous jsonb not null,updated jsonb not null
);
revoke all on table tutor_private.lesson_feedback_audit from public,anon,authenticated;
revoke all on sequence tutor_private.lesson_feedback_audit_id_seq from public,anon,authenticated;
create or replace function tutor_private.v35_track_lesson_feedback()
 returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.lesson_content,new.focus_rating,new.mood_rating,new.remarks)
  is distinct from (old.lesson_content,old.focus_rating,old.mood_rating,old.remarks) then
  insert into tutor_private.lesson_feedback_audit(lesson_id,actor_id,previous,updated)
  values(old.id,auth.uid(),
   jsonb_build_object('lesson_content',old.lesson_content,'focus_rating',old.focus_rating,
   'mood_rating',old.mood_rating,'remarks',old.remarks),
   jsonb_build_object('lesson_content',new.lesson_content,'focus_rating',new.focus_rating,
   'mood_rating',new.mood_rating,'remarks',new.remarks));
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v35_track_lesson_feedback() from public,anon,authenticated;
drop trigger if exists trg_v35_track_lesson_feedback on public.lesson_records;
create trigger trg_v35_track_lesson_feedback after update on public.lesson_records
 for each row execute function tutor_private.v35_track_lesson_feedback();

-- Student RPC intentionally returns learning fields only; never include financial columns.
CREATE OR REPLACE FUNCTION public.student_portal_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
 'students',coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'teacher_id',s.teacher_id,'subject',s.subject))
   from public.student_links sl join public.students s on s.id=sl.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb),
 'lessons',coalesce((select jsonb_agg(jsonb_build_object(
   'id',l.id,'student_id',l.student_id,'lesson_date',l.lesson_date,
   'schedule_id',l.schedule_id,'scheduled_date',l.scheduled_date,
   'subject',l.subject,'start_time',l.start_time,'end_time',l.end_time,
   'type',l.type,'remarks',l.remarks,'lesson_content',l.lesson_content,'mood_rating',l.mood_rating,'focus_rating',l.focus_rating,
   'attitude_rating',l.attitude_rating,'hours',l.hours,'updated_at',l.updated_at))
   from public.lesson_records l join public.student_links sl on sl.student_id=l.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb),
 'schedules',coalesce((select jsonb_agg(jsonb_build_object(
   'id',r.id,'student_id',r.student_id,'teacher_id',r.teacher_id,'subject',r.subject,
   'starts_on',r.starts_on,'ends_on',r.ends_on,'cancelled_from',r.cancelled_from,
   'weekdays',r.weekdays,'every_weeks',r.every_weeks,
   'start_time',r.start_time,'end_time',r.end_time,'updated_at',r.updated_at))
   from public.recurring_schedules r join public.student_links sl on sl.student_id=r.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb),
 'exceptions',coalesce((select jsonb_agg(jsonb_build_object(
   'schedule_id',e.schedule_id,'original_date',e.original_date,
   'action',e.action,'moved_to',e.moved_to))
   from public.schedule_exceptions e
   join public.recurring_schedules r on r.id=e.schedule_id
   join public.student_links sl on sl.student_id=r.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb)
);
$function$;
