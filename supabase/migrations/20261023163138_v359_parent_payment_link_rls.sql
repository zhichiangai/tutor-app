-- Require an active guardian link to the exact teacher, student and workspace.
-- Teachers retain historical read access. This migration changes no payment rows.
drop policy if exists batch_read_by_teacher_or_parent on public.payment_batches;
create policy batch_read_by_teacher_or_parent
on public.payment_batches for select to authenticated
using (
 teacher_id=(select auth.uid())
 or (
   parent_id=(select auth.uid())
   and exists (
     select 1 from public.student_guardians g
     where g.guardian_id=(select auth.uid())
       and g.teacher_id=payment_batches.teacher_id
       and g.student_id=payment_batches.student_id
       and g.workspace_id=payment_batches.workspace_id
   )
 )
);

drop policy if exists items_read_by_batch_participant on public.payment_batch_items;
create policy items_read_by_batch_participant
on public.payment_batch_items for select to authenticated
using (
 exists (
   select 1 from public.payment_batches b
   where b.id=payment_batch_items.batch_id
     and b.workspace_id=payment_batch_items.workspace_id
     and (
       b.teacher_id=(select auth.uid())
       or (
         b.parent_id=(select auth.uid())
         and exists (
           select 1 from public.student_guardians g
           where g.guardian_id=(select auth.uid())
             and g.teacher_id=b.teacher_id
             and g.student_id=b.student_id
             and g.workspace_id=b.workspace_id
         )
       )
     )
 )
);

drop policy if exists requests_teacher_or_parent_view on public.family_requests;
create policy requests_teacher_or_parent_view
on public.family_requests for select to authenticated
using (
 teacher_id=(select auth.uid())
 or (
   parent_id=(select auth.uid())
   and exists (
     select 1 from public.student_guardians g
     where g.guardian_id=(select auth.uid())
       and g.teacher_id=family_requests.teacher_id
       and g.student_id=family_requests.student_id
       and g.workspace_id=family_requests.workspace_id
   )
 )
);
