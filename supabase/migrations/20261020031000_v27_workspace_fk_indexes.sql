-- Composite FK covering indexes for V2.7 workspace isolation.
create index if not exists family_requests_lesson_workspace_idx on public.family_requests(lesson_id,workspace_id);
create index if not exists family_requests_student_workspace_idx on public.family_requests(student_id,workspace_id);
create index if not exists guardian_invites_student_workspace_idx on public.guardian_invites(student_id,workspace_id);
create index if not exists lesson_records_student_workspace_idx on public.lesson_records(student_id,workspace_id);
create index if not exists payment_batch_items_batch_workspace_idx on public.payment_batch_items(batch_id,workspace_id);
create index if not exists payment_batch_items_lesson_workspace_idx on public.payment_batch_items(lesson_id,workspace_id);
create index if not exists payment_batches_student_workspace_idx on public.payment_batches(student_id,workspace_id);
create index if not exists recurring_schedules_student_workspace_idx on public.recurring_schedules(student_id,workspace_id);
create index if not exists schedule_exceptions_schedule_workspace_idx on public.schedule_exceptions(schedule_id,workspace_id);
create index if not exists student_guardians_student_workspace_idx on public.student_guardians(student_id,workspace_id);