-- CANDIDATE ONLY — not in supabase/migrations; do not run on Production.
-- Per-payment-batch QA classification, distinct from V4 students.is_qa.
-- Intended for teacher-owned confirmed test transfers without altering amounts/status.
-- IMPORTANT: This is only the schema and audit layer; frontend summaries must be
-- taught to exclude classified confirmed allocations before any rollout.
-- Legacy lesson_records marked '老師已收到' with no payment batch are NOT covered.
-- No automatic classification from free-text notes and no existing row mutations.
begin;

create schema if not exists tutor_private;

create table public.v4_payment_batch_qa_marks (
  batch_id uuid primary key references public.payment_batches(id) on delete restrict,
  is_qa boolean not null,
  reason text not null,
  classified_by uuid not null references auth.users(id),
  classified_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint v4_qa_mark_reason_length check (char_length(btrim(reason)) between 10 and 500)
);
alter table public.v4_payment_batch_qa_marks enable row level security;
revoke all on public.v4_payment_batch_qa_marks from public, anon, authenticated;
grant select, insert, update on public.v4_payment_batch_qa_marks to authenticated;

create policy v4_qa_mark_teacher_select
on public.v4_payment_batch_qa_marks for select to authenticated
using (exists (
  select 1 from public.payment_batches b
  where b.id=v4_payment_batch_qa_marks.batch_id
    and b.teacher_id=(select auth.uid())
));
create policy v4_qa_mark_teacher_insert
on public.v4_payment_batch_qa_marks for insert to authenticated
with check (exists (
  select 1 from public.payment_batches b
  where b.id=v4_payment_batch_qa_marks.batch_id
    and b.teacher_id=(select auth.uid())
));
create policy v4_qa_mark_teacher_update
on public.v4_payment_batch_qa_marks for update to authenticated
using (exists (
  select 1 from public.payment_batches b
  where b.id=v4_payment_batch_qa_marks.batch_id
    and b.teacher_id=(select auth.uid())
))
with check (exists (
  select 1 from public.payment_batches b
  where b.id=v4_payment_batch_qa_marks.batch_id
    and b.teacher_id=(select auth.uid())
));

create table tutor_private.v4_payment_batch_qa_audit (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.payment_batches(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  previous_is_qa boolean not null,
  new_is_qa boolean not null,
  reason text not null,
  changed_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table tutor_private.v4_payment_batch_qa_audit enable row level security;
revoke all on tutor_private.v4_payment_batch_qa_audit from public, anon, authenticated;
create index v4_qa_audit_batch_time_idx
  on tutor_private.v4_payment_batch_qa_audit(batch_id,changed_at desc);

create function tutor_private.v4_guard_and_audit_payment_qa_mark()
returns trigger language plpgsql security definer set search_path=''
as $body$
declare
  v_actor uuid := (select auth.uid());
  v_teacher uuid;
  v_previous boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if tg_op='UPDATE' then
    if new.batch_id is distinct from old.batch_id then
      raise exception 'Cannot move a QA classification to another payment';
    end if;
    v_previous:=old.is_qa;
    if new.is_qa is not distinct from old.is_qa then
      raise exception 'Classification is unchanged';
    end if;
  end if;
  if new.is_qa is null or new.reason is null
     or char_length(btrim(new.reason)) not between 10 and 500 then
    raise exception 'QA classification requires a documented 10–500 character reason';
  end if;
  select b.teacher_id into v_teacher
  from public.payment_batches b where b.id=new.batch_id for update;
  if v_teacher is null or v_teacher is distinct from v_actor then
    raise exception 'Only the owning teacher can classify this payment';
  end if;
  new.classified_by:=v_actor;
  new.classified_at:=pg_catalog.clock_timestamp();
  insert into tutor_private.v4_payment_batch_qa_audit
    (batch_id,actor_id,previous_is_qa,new_is_qa,reason,changed_at)
  values (new.batch_id,v_actor,v_previous,new.is_qa,new.reason,new.classified_at);
  return new;
end;
$body$;
revoke execute on function tutor_private.v4_guard_and_audit_payment_qa_mark()
  from public,anon,authenticated;
create trigger v4_guard_audit_qa_payment_classification
before insert or update on public.v4_payment_batch_qa_marks
for each row execute function tutor_private.v4_guard_and_audit_payment_qa_mark();

-- This schema intentionally does not backfill old QA data, overwrite payments,
-- hide balances, or mutate migration history. Test with isolated teacher/parent
-- GoTrue sessions before designing the UI or applying any Production migration.
commit;
