-- V3.3 compatibility: V3.2 student_invites was added alongside the older
-- student_invitations/student_links(invitation_id) schema.
-- Claim must bridge the invitation rather than write to nonexistent student_links.invite_id.
create or replace function public.claim_student_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare
  v public.student_invites%rowtype;
  v_legacy_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v from public.student_invites where id=p_invite_id for share;
  if not found or v.email<>lower(coalesce((auth.jwt()->>'email'),'')) then
    raise exception 'No invitation for this account';
  end if;
  select id into v_legacy_id from public.student_invitations
    where student_id=v.student_id and teacher_id=v.teacher_id and email=v.email for share;
  if v_legacy_id is null then
    insert into public.student_invitations(student_id,teacher_id,email)
      values(v.student_id,v.teacher_id,v.email)
      on conflict(student_id,email) do update set email=excluded.email
      returning id into v_legacy_id;
  end if;
  insert into public.student_links(invitation_id,teacher_id,student_id,user_id)
    values(v_legacy_id,v.teacher_id,v.student_id,auth.uid())
    on conflict(student_id,user_id) do nothing;
end;$$;
revoke all on function public.claim_student_invite(uuid) from public,anon;
grant execute on function public.claim_student_invite(uuid) to authenticated;

-- Revoking V3.2 invite also removes its bridged invitation and the linked account.
-- This is intentionally scoped by matching teacher, student and the exact invited email.
create or replace function tutor_private.revoke_shared_student_invite()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 delete from public.student_invitations i
  where i.teacher_id=old.teacher_id and i.student_id=old.student_id
    and i.email=old.email;
 return old;
end;$$;
revoke all on function tutor_private.revoke_shared_student_invite() from public,anon,authenticated;
drop trigger if exists trg_revoke_shared_student_invite on public.student_invites;
create trigger trg_revoke_shared_student_invite
 after delete on public.student_invites for each row
 execute function tutor_private.revoke_shared_student_invite();
