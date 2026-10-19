-- V2.6 hardened RLS and supporting indexes. Reconciles production migrations
-- v26_close_cross_user_rls_and_validate_requests,
-- v26_optimize_rls_policies_and_foreign_key_indexes,
-- v26_cache_jwt_claim_in_rls_policy.
-- Intentionally preserves normal teacher/guardian access and existing rows.
drop policy if exists no_fake_request_dates_only_valid_schedule on public.recurring_schedules;
drop policy if exists owners_select_lessons on public.lesson_records;
drop policy if exists guardian_view_own_lessons on public.lesson_records;
drop policy if exists "invites_teacher_or_email_read" on public."guardian_invites";
create policy "invites_teacher_or_email_read" on public."guardian_invites" for select to authenticated using (
((teacher_id = ( SELECT auth.uid() AS uid)) OR (lower(email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))))
);

drop policy if exists "lessons_owner_or_guardian_select" on public."lesson_records";
create policy "lessons_owner_or_guardian_select" on public."lesson_records" for select to authenticated using (
((owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM student_guardians g
  WHERE ((g.student_id = lesson_records.student_id) AND (g.guardian_id = ( SELECT auth.uid() AS uid))))))
);

drop policy if exists "links_guardian_claim_invite" on public."student_guardians";
create policy "links_guardian_claim_invite" on public."student_guardians" for insert to authenticated with check (
((guardian_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM guardian_invites i
  WHERE ((i.id = student_guardians.invite_id) AND (i.teacher_id = student_guardians.teacher_id) AND (i.student_id = student_guardians.student_id) AND (lower(i.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text)))))))
);

drop policy if exists "requests_guardian_create" on public."family_requests";
create policy "requests_guardian_create" on public."family_requests" for insert to authenticated with check (
((parent_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (reviewed_at IS NULL) AND (EXISTS ( SELECT 1
   FROM student_guardians g
  WHERE ((g.student_id = family_requests.student_id) AND (g.teacher_id = family_requests.teacher_id) AND (g.guardian_id = ( SELECT auth.uid() AS uid))))) AND (((lesson_id IS NOT NULL) AND (schedule_id IS NULL) AND (scheduled_date IS NULL) AND (EXISTS ( SELECT 1
   FROM lesson_records l
  WHERE ((l.id = family_requests.lesson_id) AND (l.owner_id = family_requests.teacher_id) AND (l.student_id = family_requests.student_id) AND (((family_requests.kind = 'time_correction'::text) AND (l.type = 'lesson'::text)) OR ((family_requests.kind = 'payment'::text) AND (l.type = 'lesson'::text)) OR ((family_requests.kind = 'leave'::text) AND (l.type = ANY (ARRAY['planned'::text, 'lesson'::text])))))))) OR ((lesson_id IS NULL) AND (schedule_id IS NOT NULL) AND (scheduled_date IS NOT NULL) AND (kind = 'leave'::text) AND (EXISTS ( SELECT 1
   FROM recurring_schedules s
  WHERE ((s.id = family_requests.schedule_id) AND (s.teacher_id = family_requests.teacher_id) AND (s.student_id = family_requests.student_id) AND (family_requests.scheduled_date >= s.starts_on) AND ((s.ends_on IS NULL) OR (family_requests.scheduled_date <= s.ends_on)) AND ((EXTRACT(isodow FROM family_requests.scheduled_date))::smallint = ANY (s.weekdays)) AND ((((family_requests.scheduled_date - (s.starts_on - ((EXTRACT(isodow FROM s.starts_on))::integer - 1))) / 7) % (s.every_weeks)::integer) = 0)))))))
);

create index if not exists "family_requests_lesson_id_fk_idx" on public."family_requests" (lesson_id);
create index if not exists "family_requests_schedule_id_fk_idx" on public."family_requests" (schedule_id);
create index if not exists "family_requests_student_teacher_fk_idx" on public."family_requests" (student_id,teacher_id);
create index if not exists "guardian_invites_student_teacher_fk_idx" on public."guardian_invites" (student_id,teacher_id);
create index if not exists "guardian_invites_teacher_fk_idx" on public."guardian_invites" (teacher_id);
create index if not exists "lesson_records_student_owner_fk_idx" on public."lesson_records" (student_id,owner_id);
create index if not exists "payment_batches_student_teacher_fk_idx" on public."payment_batches" (student_id,teacher_id);
create index if not exists "recurring_schedules_student_teacher_fk_idx" on public."recurring_schedules" (student_id,teacher_id);
create index if not exists "recurring_schedules_teacher_fk_idx" on public."recurring_schedules" (teacher_id);
create index if not exists "schedule_exceptions_schedule_teacher_fk_idx" on public."schedule_exceptions" (schedule_id,teacher_id);
create index if not exists "student_guardians_invite_fk_idx" on public."student_guardians" (invite_id);
create index if not exists "student_guardians_student_teacher_fk_idx" on public."student_guardians" (student_id,teacher_id);
create index if not exists "student_guardians_teacher_fk_idx" on public."student_guardians" (teacher_id);
