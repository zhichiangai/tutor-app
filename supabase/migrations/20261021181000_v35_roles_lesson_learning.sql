-- V3.5 core settings and teaching feedback
alter table public.profiles add column if not exists enabled_roles text[] not null default array['teacher']::text[];
alter table public.lesson_records add column if not exists lesson_content text;
alter table public.lesson_records add column if not exists mood_rating smallint;
