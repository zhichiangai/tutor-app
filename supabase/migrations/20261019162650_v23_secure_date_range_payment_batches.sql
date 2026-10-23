
create table public.payment_batches (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid not null,
 parent_id uuid not null references auth.users(id) on delete cascade,
 period_start date not null,
 period_end date not null,
 paid_on date not null,
 paid_amount numeric(12,2) not null check(paid_amount>0),
 note text not null default '',
 status text not null default 'pending' check(status in ('pending','confirmed','declined')),
 received_on date,
 confirmed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key (student_id,teacher_id) references public.students(id,teacher_id) on delete cascade,
 check(period_end>=period_start),
 check(period_end-period_start <= 730),
 check ((status='confirmed' and received_on is not null and confirmed_at is not null) or (status <> 'confirmed' and received_on is null))
);
create index payment_batches_teacher_idx on public.payment_batches(teacher_id,status,period_end desc);
create index payment_batches_parent_idx on public.payment_batches(parent_id,created_at desc);

create table public.payment_batch_items (
 batch_id uuid not null references public.payment_batches(id) on delete cascade,
 lesson_id uuid not null references public.lesson_records(id) on delete restrict,
 allocated_amount numeric(12,2) not null check(allocated_amount>0),
 primary key (batch_id,lesson_id)
);
create index payment_batch_items_lesson_idx on public.payment_batch_items(lesson_id);

alter table public.payment_batches enable row level security;
alter table public.payment_batch_items enable row level security;
revoke all on public.payment_batches, public.payment_batch_items from anon,authenticated;
grant select on public.payment_batches,public.payment_batch_items to authenticated;

create policy "batch_read_by_teacher_or_parent" on public.payment_batches for select to authenticated using (
 teacher_id=(select auth.uid()) or parent_id=(select auth.uid())
);
create policy "items_read_by_batch_participant" on public.payment_batch_items for select to authenticated using (
 exists(select 1 from public.payment_batches b where b.id=payment_batch_items.batch_id and (b.teacher_id=(select auth.uid()) or b.parent_id=(select auth.uid())))
);

create schema if not exists tutor_private;
revoke all on schema tutor_private from public;
grant usage on schema tutor_private to authenticated;

create or replace function tutor_private.submit_range_payment(
 p_teacher_id uuid,p_student_id uuid,p_period_start date,p_period_end date,
 p_paid_on date,p_paid_amount numeric,p_note text
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_left numeric(12,2);
 v_available numeric(12,2);
 v_reserved numeric(12,2);
 v_sum numeric(12,2):=0;
 v_batch uuid;
 v_row record;
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 if p_teacher_id is null or p_student_id is null then raise exception 'Student and teacher are required'; end if;
 if p_period_start is null or p_period_end is null or p_period_start>p_period_end or p_period_end-p_period_start>730
 then raise exception 'Invalid date range'; end if;
 if p_paid_on is null or p_paid_on>current_date then raise exception 'Payment date cannot be in the future'; end if;
 if p_paid_amount is null or p_paid_amount<=0 or p_paid_amount<>round(p_paid_amount,2) then raise exception 'Invalid payment amount'; end if;
 if length(coalesce(p_note,''))>500 then raise exception 'Note too long'; end if;
 if not exists(
  select 1 from public.student_guardians g
  join public.students s on s.id=g.student_id and s.teacher_id=g.teacher_id
  where g.student_id=p_student_id and g.teacher_id=p_teacher_id and g.guardian_id=v_actor
 ) then raise exception 'Not authorized for this student'; end if;

 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_student_id::text));
 -- Lock all eligible lesson rows to keep the amount calculation stable.
 perform 1 from public.lesson_records l
  where l.student_id=p_student_id and l.owner_id=p_teacher_id
    and l.lesson_date between p_period_start and p_period_end
    and l.type='lesson'
  order by l.lesson_date,l.id for update;

 for v_row in
  select l.id,l.total_amount,l.status,l.lesson_date from public.lesson_records l
  where l.student_id=p_student_id and l.owner_id=p_teacher_id
    and l.lesson_date between p_period_start and p_period_end
    and l.type='lesson' and l.total_amount>0
    and l.status not in ('老師已收到','家長已付款')
    and not exists(select 1 from public.family_requests r where r.lesson_id=l.id and r.kind='payment' and r.status in ('pending','approved'))
  order by l.lesson_date,l.id
 loop
  select coalesce(sum(i.allocated_amount),0) into v_reserved
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_row.id and b.status in ('pending','confirmed');
  v_sum:=v_sum+greatest(v_row.total_amount-v_reserved,0);
 end loop;
 if v_sum=0 then raise exception 'No eligible unpaid lessons for this period'; end if;
 if p_paid_amount>v_sum+0.005 then raise exception 'Payment exceeds available unpaid amount'; end if;

 insert into public.payment_batches (teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,note)
 values (p_teacher_id,p_student_id,v_actor,p_period_start,p_period_end,p_paid_on,p_paid_amount,coalesce(p_note,''))
 returning id into v_batch;

 v_left:=p_paid_amount;
 for v_row in
  select l.id,l.total_amount from public.lesson_records l
  where l.student_id=p_student_id and l.owner_id=p_teacher_id
    and l.lesson_date between p_period_start and p_period_end
    and l.type='lesson' and l.total_amount>0
    and l.status not in ('老師已收到','家長已付款')
    and not exists(select 1 from public.family_requests r where r.lesson_id=l.id and r.kind='payment' and r.status in ('pending','approved'))
  order by l.lesson_date,l.id
 loop
  exit when v_left <= 0;
  select coalesce(sum(i.allocated_amount),0) into v_reserved
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=v_row.id and b.status in ('pending','confirmed');
  v_available:=least(v_left,greatest(v_row.total_amount-v_reserved,0));
  if v_available>0 then
   insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values(v_batch,v_row.id,v_available);
   v_left:=v_left-v_available;
  end if;
 end loop;
 if v_left>0.005 then raise exception 'Could not allocate full reported amount'; end if;
 return v_batch;
end; $$;

create or replace function tutor_private.review_range_payment(
 p_batch_id uuid,p_confirm boolean,p_received_on date
) returns void
language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_batch public.payment_batches%rowtype;
 v_item record;
 v_confirmed numeric(12,2);
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 select * into v_batch from public.payment_batches b where b.id=p_batch_id for update;
 if not found or v_batch.teacher_id<>v_actor or v_batch.status<>'pending'
 then raise exception 'Batch not found, already processed or not authorized'; end if;
 if p_confirm and (p_received_on is null or p_received_on>current_date)
 then raise exception 'Actual receipt date is required and cannot be in the future'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_batch.student_id::text));
 if p_confirm then
   for v_item in
    select i.lesson_id,i.allocated_amount,l.total_amount,l.status,l.type
    from public.payment_batch_items i join public.lesson_records l on l.id=i.lesson_id
    where i.batch_id=p_batch_id for update of l
   loop
    if v_item.type<>'lesson' then raise exception 'Course status changed; review before confirming'; end if;
    if v_item.status='老師已收到' then raise exception 'This course has already been marked received'; end if;
    select coalesce(sum(i.allocated_amount),0) into v_confirmed from public.payment_batch_items i
      join public.payment_batches b on b.id=i.batch_id
      where i.lesson_id=v_item.lesson_id and b.status in ('pending','confirmed');
    if v_confirmed>v_item.total_amount+0.005 then raise exception 'Payment exceeds lesson total'; end if;
   end loop;
 end if;
 update public.payment_batches set status=case when p_confirm then 'confirmed' else 'declined' end,
    received_on=case when p_confirm then p_received_on else null end,
    confirmed_at=case when p_confirm then now() else null end
 where id=p_batch_id;
 if p_confirm then
  for v_item in select distinct lesson_id from public.payment_batch_items where batch_id=p_batch_id loop
   select coalesce(sum(i.allocated_amount),0) into v_confirmed from public.payment_batch_items i
     join public.payment_batches b on b.id=i.batch_id
     where i.lesson_id=v_item.lesson_id and b.status='confirmed';
   update public.lesson_records l set
     status=case when v_confirmed>=l.total_amount-0.005 then '老師已收到' else '未付款' end,
     received_date=case when v_confirmed>=l.total_amount-0.005 then p_received_on else null end,
     updated_at=now()
   where l.id=v_item.lesson_id and l.owner_id=v_actor;
  end loop;
 end if;
end; $$;
revoke all on function tutor_private.submit_range_payment(uuid,uuid,date,date,date,numeric,text) from public,anon;
revoke all on function tutor_private.review_range_payment(uuid,boolean,date) from public,anon;
grant execute on function tutor_private.submit_range_payment(uuid,uuid,date,date,date,numeric,text) to authenticated;
grant execute on function tutor_private.review_range_payment(uuid,boolean,date) to authenticated;

create or replace function public.submit_range_payment(
 p_teacher_id uuid,p_student_id uuid,p_period_start date,p_period_end date,
 p_paid_on date,p_paid_amount numeric,p_note text default ''
) returns uuid language sql security invoker set search_path='' as $$
 select tutor_private.submit_range_payment(p_teacher_id,p_student_id,p_period_start,p_period_end,p_paid_on,p_paid_amount,p_note);
$$;
create or replace function public.review_range_payment(
 p_batch_id uuid,p_confirm boolean,p_received_on date default null
) returns void language sql security invoker set search_path='' as $$
 select tutor_private.review_range_payment(p_batch_id,p_confirm,p_received_on);
$$;
revoke all on function public.submit_range_payment(uuid,uuid,date,date,date,numeric,text) from public,anon;
revoke all on function public.review_range_payment(uuid,boolean,date) from public,anon;
grant execute on function public.submit_range_payment(uuid,uuid,date,date,date,numeric,text) to authenticated;
grant execute on function public.review_range_payment(uuid,boolean,date) to authenticated;
