
alter table public.lesson_records
  add constraint lesson_records_student_owner_match
  foreign key (student_id, owner_id)
  references public.students(id, teacher_id)
  on delete no action;
create unique index if not exists family_requests_one_pending
  on public.family_requests (parent_id,lesson_id,kind)
  where status = 'pending' and lesson_id is not null;
