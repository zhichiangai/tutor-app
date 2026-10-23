create table if not exists public.lesson_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  type text not null default 'lesson',
  leave_source text,
  payment_group_id text,
  lesson_date date not null,
  student text,
  subject text,
  start_time text,
  end_time text,
  hours numeric(8,2) not null default 0,
  hourly_rate numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  status text not null default '未付款',
  payment_date date,
  received_date date,
  parent_note text,
  remarks text,
  focus_rating integer check (focus_rating between 1 and 5),
  attitude_rating integer check (attitude_rating between 1 and 5),
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_records_owner_legacy_unique unique (owner_id, legacy_id)
);
create index if not exists lesson_records_owner_date_idx on public.lesson_records (owner_id, lesson_date);
alter table public.lesson_records enable row level security;
revoke all on public.lesson_records from anon;
grant select, insert, update, delete on public.lesson_records to authenticated;
create policy "owners_select_lessons" on public.lesson_records for select to authenticated using ((select auth.uid()) = owner_id);
create policy "owners_insert_lessons" on public.lesson_records for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "owners_update_lessons" on public.lesson_records for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "owners_delete_lessons" on public.lesson_records for delete to authenticated using ((select auth.uid()) = owner_id);
