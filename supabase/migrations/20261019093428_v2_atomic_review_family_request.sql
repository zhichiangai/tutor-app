
create or replace function public.review_family_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare r public.family_requests%rowtype;
begin
  select * into r
  from public.family_requests fr
  where fr.id=p_request_id and fr.teacher_id=(select auth.uid()) and fr.status='pending'
  for update;
  if not found then raise exception 'Request not found or no permission'; end if;

  if p_approve and r.lesson_id is not null then
    if r.kind = 'leave' then
      update public.lesson_records set type='leave', leave_source='student', updated_at=now()
      where id=r.lesson_id and owner_id=(select auth.uid()) and student_id=r.student_id;
    else
      update public.lesson_records set status='家長已付款', payment_date=current_date, updated_at=now()
      where id=r.lesson_id and owner_id=(select auth.uid()) and student_id=r.student_id;
    end if;
    if not found then raise exception 'Related lesson not found'; end if;
  end if;

  update public.family_requests
  set status=case when p_approve then 'approved' else 'declined' end, reviewed_at=now()
  where id=r.id;
end;
$$;
revoke all on function public.review_family_request(uuid,boolean) from public,anon;
grant execute on function public.review_family_request(uuid,boolean) to authenticated;
