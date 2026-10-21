-- V3.5 core settings and teaching feedback
alter table public.profiles add column if not exists enabled_roles text[] not null default array['teacher']::text[];
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
