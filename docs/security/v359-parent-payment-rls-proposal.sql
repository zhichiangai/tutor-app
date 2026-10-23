-- REVIEW-ONLY PROPOSAL. Do not execute against production directly.
-- Use supabase migration new after passing a full staging JWT/RLS regression.
-- Purpose: revoke parental payment read access when the exact student+teacher
-- guardian link is removed, while preserving teacher audit visibility.
--
-- Existing policy names confirmed by read-only pg_policies inspection:
--   payment_batches.batch_read_by_teacher_or_parent
--   payment_batch_items.items_read_by_batch_participant
--
-- Assumes current production schema includes workspace_id on both
-- payment_batches and student_guardians. Review ALL existing Supabase
-- migrations and relevant RPCs before applying.

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

-- Staging test matrix:
-- 1) Teacher A can still SELECT his/her own batches and allocation items.
-- 2) Parent P linked to student S under teacher A can read exactly S/A.
-- 3) Parent P has an old batch for S/A but no CURRENT student_guardians row:
--    zero rows via SELECT on payment_batches AND payment_batch_items.
-- 4) Same parent P still linked to T/B keeps T/B access.
-- 5) Another parent Q cannot read P's batches.
-- 6) No teacher may read another teacher's batches.
-- 7) Direct PostgREST select, joins, RPCs, nested filters, service_role
--    behavior, and session refresh must be verified.
-- 8) RLS revoke must not DELETE archived financial records or alter amounts.
-- 9) Review and scope legacy family_requests payment visibility separately.
