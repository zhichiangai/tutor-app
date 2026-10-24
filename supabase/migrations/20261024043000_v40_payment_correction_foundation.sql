-- V4 DRAFT FOUNDATION ONLY: immutable correction storage and teacher-only preview.
-- Existing payment flow is intentionally unchanged; there is NO correction-write RPC.
-- DO NOT promote this migration until review_range_payment, submit_range_payment,
-- guard_paid_lesson, frontend ledgers and full JWT/RLS tests are integrated.
create table public.payment_batch_corrections (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payment_batches(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (length(request_hash)=64),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  amount numeric(12,2) not null check (amount>0),
  created_at timestamptz not null default clock_timestamp(),
  unique(id,batch_id),
  unique(batch_id,idempotency_key)
);
create table public.payment_batch_correction_items (
  correction_id uuid not null,
  batch_id uuid not null,
  lesson_id uuid not null,
  amount numeric(12,2) not null check (amount>0),
  primary key(correction_id,lesson_id),
  foreign key(correction_id,batch_id)
    references public.payment_batch_corrections(id,batch_id) on delete restrict,
  foreign key(batch_id,lesson_id)
    references public.payment_batch_items(batch_id,lesson_id) on delete restrict
);
create index payment_batch_corrections_batch_idx
  on public.payment_batch_corrections(batch_id,created_at);
create index payment_batch_correction_items_lesson_idx
  on public.payment_batch_correction_items(lesson_id);
alter table public.payment_batch_corrections enable row level security;
alter table public.payment_batch_correction_items enable row level security;
revoke all on public.payment_batch_corrections,public.payment_batch_correction_items
  from public,anon,authenticated;
grant select on public.payment_batch_corrections,public.payment_batch_correction_items to authenticated;

-- A parent may read correction history only for the currently linked
-- student+teacher+workspace. Teacher preserves legally relevant own history.
create policy v4_corrections_select on public.payment_batch_corrections
  for select to authenticated using (
    exists (
      select 1 from public.payment_batches b
      where b.id=payment_batch_corrections.batch_id
      and (
        b.teacher_id=(select auth.uid())
        or (b.parent_id=(select auth.uid())
            and exists (
              select 1 from public.student_guardians g
              where g.guardian_id=(select auth.uid())
                and g.student_id=b.student_id
                and g.teacher_id=b.teacher_id
                and g.workspace_id=b.workspace_id
            ))
      )
    )
  );
create policy v4_correction_items_select on public.payment_batch_correction_items
  for select to authenticated using (
    exists (
      select 1 from public.payment_batch_corrections c
      where c.id=payment_batch_correction_items.correction_id
        and c.batch_id=payment_batch_correction_items.batch_id
    )
  );

-- Immutable audit. A future approved SECURITY DEFINER write RPC can only INSERT,
-- and MUST atomically validate sum(lines)=header.amount, ownership, original
-- allocation caps, no excess, original batch confirmed, and idempotency.
create function tutor_private.v4_keep_correction_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Payment correction audit is immutable';
end $$;
revoke all on function tutor_private.v4_keep_correction_immutable()
  from public,anon,authenticated;
create trigger v4_correction_header_immutable
before update or delete on public.payment_batch_corrections
for each row execute function tutor_private.v4_keep_correction_immutable();
create trigger v4_correction_items_immutable
before update or delete on public.payment_batch_correction_items
for each row execute function tutor_private.v4_keep_correction_immutable();

-- Read-only teacher preview. No mutation or permission escalation.
create function public.v4_payment_correction_preview(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_batch public.payment_batches%rowtype;
  v_lines jsonb;
  v_total numeric(12,2);
begin
  if v_actor is null then raise exception '請先登入'; end if;
  select * into v_batch from public.payment_batches b
    where b.id=p_batch_id and b.teacher_id=v_actor and b.status='confirmed';
  if not found then raise exception '找不到本人已確認的付款批次'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_id',i.lesson_id,
    'original',i.allocated_amount,
    'corrected',coalesce(x.corrected,0),
    'net',i.allocated_amount-coalesce(x.corrected,0)
  ) order by i.lesson_id),'[]'::jsonb),
  coalesce(sum(i.allocated_amount-coalesce(x.corrected,0)),0)
  into v_lines,v_total
  from public.payment_batch_items i
  left join lateral (
    select coalesce(sum(ci.amount),0)::numeric(12,2) corrected
    from public.payment_batch_correction_items ci
    where ci.batch_id=i.batch_id and ci.lesson_id=i.lesson_id
  ) x on true
  where i.batch_id=v_batch.id;
  return jsonb_build_object(
    'batch_id',v_batch.id,'status',v_batch.status,'original',v_batch.paid_amount,
    'remaining',v_total,'lines',v_lines,
    'can_apply',false,'note','本版本僅預覽；尚未開放沖銷操作'
  );
end $$;
revoke all on function public.v4_payment_correction_preview(uuid)
  from public,anon;
grant execute on function public.v4_payment_correction_preview(uuid) to authenticated;
