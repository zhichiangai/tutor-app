-- Opt-in QA classification and historical time provenance. Existing rows keep
-- their amounts, duration and ordinary (unmarked) classification.
alter table public.students add column is_qa boolean not null default false;
alter table public.lesson_records add column time_accuracy text not null default 'recorded'
  check (time_accuracy in ('recorded','estimated'));

create table tutor_private.qa_student_mark_audit (
  id bigint generated always as identity primary key,
  student_id uuid not null,
  teacher_id uuid not null,
  actor_id uuid not null,
  previous_is_qa boolean not null,
  new_is_qa boolean not null,
  changed_at timestamptz not null default clock_timestamp()
);
revoke all on tutor_private.qa_student_mark_audit from public, anon, authenticated;

create or replace function tutor_private.audit_qa_student_mark()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid := (select auth.uid());
begin
  if new.is_qa is distinct from old.is_qa then
    if v_actor is null or v_actor<>old.teacher_id or new.teacher_id<>old.teacher_id then
      raise exception 'Only the owning teacher may classify QA data';
    end if;
    insert into tutor_private.qa_student_mark_audit
      (student_id,teacher_id,actor_id,previous_is_qa,new_is_qa)
    values (old.id,old.teacher_id,v_actor,old.is_qa,new.is_qa);
  end if;
  return new;
end $$;
revoke all on function tutor_private.audit_qa_student_mark() from public, anon, authenticated;
create trigger audit_qa_student_mark before update of is_qa on public.students
for each row execute function tutor_private.audit_qa_student_mark();
