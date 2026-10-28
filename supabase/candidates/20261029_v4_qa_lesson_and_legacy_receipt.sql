-- CANDIDATE ONLY: not in supabase/migrations, not applied in Production.
-- Supplements the separately reviewed 20261028_v4_payment_batch_qa_classification.sql.
-- Separates (1) whole simulated lessons from (2) simulated legacy single-lesson receipts.
-- A legitimate lesson with a simulated payment BATCH should be classified at BATCH
-- level instead; do not mislabel the entire lesson or its real tuition as test data.
-- Never guess QA from student names, notes, dates or parent-supplied text.
-- No existing lesson, status, amount, batch, or history row is changed.
begin;

create schema if not exists tutor_private;

create table public.v4_lesson_qa_marks (
  lesson_id uuid primary key references public.lesson_records(id) on delete restrict,
  classification text not null
    check (classification in ('simulated_lesson','simulated_legacy_receipt')),
  is_qa boolean not null,
  reason text not null
    check (char_length(btrim(reason)) between 10 and 500),
  classified_by uuid not null references auth.users(id),
  classified_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.v4_lesson_qa_marks enable row level security;
revoke all on public.v4_lesson_qa_marks from public, anon, authenticated;
grant select, insert, update on public.v4_lesson_qa_marks to authenticated;

create policy v4_lesson_qa_teacher_select on public.v4_lesson_qa_marks
for select to authenticated
using (exists (
  select 1 from public.lesson_records l
  where l.id=v4_lesson_qa_marks.lesson_id
    and l.owner_id=(select auth.uid())
));
create policy v4_lesson_qa_teacher_insert on public.v4_lesson_qa_marks
for insert to authenticated
with check (exists (
  select 1 from public.lesson_records l
  where l.id=v4_lesson_qa_marks.lesson_id
    and l.owner_id=(select auth.uid())
));
create policy v4_lesson_qa_teacher_update on public.v4_lesson_qa_marks
for update to authenticated
using (exists (
  select 1 from public.lesson_records l
  where l.id=v4_lesson_qa_marks.lesson_id
    and l.owner_id=(select auth.uid())
))
with check (exists (
  select 1 from public.lesson_records l
  where l.id=v4_lesson_qa_marks.lesson_id
    and l.owner_id=(select auth.uid())
));

create table tutor_private.v4_lesson_qa_audit (
  id bigint generated always as identity primary key,
  lesson_id uuid not null references public.lesson_records(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  previous_classification text,
  new_classification text not null,
  previous_is_qa boolean,
  new_is_qa boolean not null,
  reason text not null,
  changed_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table tutor_private.v4_lesson_qa_audit enable row level security;
revoke all on tutor_private.v4_lesson_qa_audit from public, anon, authenticated;
create index v4_lesson_qa_audit_lesson_time_idx
  on tutor_private.v4_lesson_qa_audit(lesson_id,changed_at desc);

create function tutor_private.v4_guard_and_audit_lesson_qa_mark()
returns trigger language plpgsql security definer set search_path=''
as $body$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_type text;
  v_status text;
  v_previous_classification text;
  v_previous_is_qa boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if tg_op='UPDATE' then
    if new.lesson_id is distinct from old.lesson_id then
      raise exception 'QA classification cannot be moved to another lesson';
    end if;
    if new.is_qa is not distinct from old.is_qa
       and new.classification is not distinct from old.classification then
      raise exception 'QA classification is unchanged';
    end if;
    v_previous_classification:=old.classification;
    v_previous_is_qa:=old.is_qa;
  end if;
  if new.classification not in ('simulated_lesson','simulated_legacy_receipt')
     or new.is_qa is null
     or new.reason is null
     or char_length(btrim(new.reason)) not between 10 and 500 then
    raise exception 'Documented QA classification is required';
  end if;

  select l.owner_id,l.type,l.status into v_owner,v_type,v_status
    from public.lesson_records l where l.id=new.lesson_id for update;
  if v_owner is null or v_owner is distinct from v_actor or v_type <> 'lesson' then
    raise exception 'Only the owning teacher can classify an existing lesson';
  end if;

  -- A whole simulated lesson may not silently hide genuine confirmed cash.
  -- All confirmed allocations must be explicitly and separately QA-classified.
  if new.classification='simulated_lesson' and new.is_qa
     and exists (
       select 1 from public.payment_batch_items i
       join public.payment_batches b on b.id=i.batch_id
       left join public.v4_payment_batch_qa_marks m on m.batch_id=b.id
       where i.lesson_id=new.lesson_id and b.status='confirmed'
         and coalesce(m.is_qa,false)=false
     ) then
    raise exception 'Classify confirmed simulated payment batches before hiding a whole lesson';
  end if;

  if new.classification='simulated_legacy_receipt' and new.is_qa then
    if v_status <> '老師已收到'
       or exists (select 1 from public.payment_batch_items i
                  where i.lesson_id=new.lesson_id) then
      raise exception 'Legacy receipt QA needs a received lesson without batch allocations';
    end if;
  end if;

  new.classified_by:=v_actor;
  new.classified_at:=pg_catalog.clock_timestamp();
  insert into tutor_private.v4_lesson_qa_audit
    (lesson_id,actor_id,previous_classification,new_classification,
     previous_is_qa,new_is_qa,reason,changed_at)
  values (new.lesson_id,v_actor,v_previous_classification,new.classification,
          v_previous_is_qa,new.is_qa,new.reason,new.classified_at);
  return new;
end;
$body$;
revoke execute on function tutor_private.v4_guard_and_audit_lesson_qa_mark()
from public,anon,authenticated;
create trigger v4_guard_audit_lesson_qa_classification
before insert or update on public.v4_lesson_qa_marks
for each row execute function tutor_private.v4_guard_and_audit_lesson_qa_mark();

-- No automated backfill. Marking changes balance calculations only AFTER a
-- separate, tested client/server read integration and deliberate rollout.
commit;
