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
