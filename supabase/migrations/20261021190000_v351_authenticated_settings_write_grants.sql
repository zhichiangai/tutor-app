-- V3.5.1: restore the missing SQL UPDATE privileges behind existing authenticated RLS.
--
-- Background: profile_self_update, workspace_owner_rename and
-- invites_teacher_update_pending policies already exist, but authenticated
-- has no UPDATE permission on these tables. RLS cannot grant table privileges;
-- both SQL privilege and RLS row checks are required for the settings UI.
--
-- Grant only the exact columns needed by the currently deployed application.
-- Do not grant UPDATE of owner_id, teacher_id, student_id, id, kind or any
-- financial columns. Existing restrictive RLS continues to apply.
grant update (display_name, last_role, enabled_roles, roles_configured)
  on table public.profiles to authenticated;

grant update (name) on table public.workspaces to authenticated;

grant update (email) on table public.guardian_invites to authenticated;
