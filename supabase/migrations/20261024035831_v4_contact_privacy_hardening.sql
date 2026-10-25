-- Do not expose whether a submitted email corresponds to an account.
-- Outgoing requests remain invisible until the recipient accepts. Incoming
-- requests are visible to the recipient so they can approve or decline.
create or replace function public.v4_contact_inbox()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid := (select auth.uid()); v_rows jsonb;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'id',c.id,'status',c.status,'my_role',
    case when c.teacher_id=v_actor then 'teacher' else 'parent' end,
  'other_name',coalesce(nullif(p.display_name,''),'另一位使用者'),
  'requested_by_me',c.requested_by=v_actor,
  'created_at',c.created_at
 ) order by c.created_at desc),'[]'::jsonb)
 into v_rows
 from public.v4_account_contacts c
 left join public.profiles p
   on p.id=(case when c.teacher_id=v_actor then c.parent_id else c.teacher_id end)
 where (c.teacher_id=v_actor or c.parent_id=v_actor)
   and (c.status in ('connected','disconnected')
     or (c.status='pending' and c.requested_by<>v_actor));
 return v_rows;
end $$;
revoke all on function public.v4_contact_inbox() from public,anon;
grant execute on function public.v4_contact_inbox() to authenticated;
