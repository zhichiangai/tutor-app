-- V3 teacher-specific form preferences. No student/payment content is stored.
create table if not exists public.teacher_preferences(
  owner_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint teacher_prefs_json_shape check (jsonb_typeof(settings)='object' and pg_column_size(settings)<=8192)
);
alter table public.teacher_preferences enable row level security;
revoke all on public.teacher_preferences from public,anon,authenticated;
grant select,insert,update on public.teacher_preferences to authenticated;
drop policy if exists teacher_preferences_own_select on public.teacher_preferences;
create policy teacher_preferences_own_select on public.teacher_preferences
 for select to authenticated using (owner_id=(select auth.uid()));
drop policy if exists teacher_preferences_own_insert on public.teacher_preferences;
create policy teacher_preferences_own_insert on public.teacher_preferences
 for insert to authenticated with check (owner_id=(select auth.uid()) and
  exists(select 1 from public.workspaces w where w.owner_id=(select auth.uid())));
drop policy if exists teacher_preferences_own_update on public.teacher_preferences;
create policy teacher_preferences_own_update on public.teacher_preferences
 for update to authenticated using (owner_id=(select auth.uid()))
 with check(owner_id=(select auth.uid()) and
  exists(select 1 from public.workspaces w where w.owner_id=(select auth.uid())));
