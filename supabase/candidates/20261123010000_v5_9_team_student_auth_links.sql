-- RAP-49: Team student Auth linkage and student-safe lessons.
-- New migrations apply AFTER the 62-migration Production base and any
-- in-flight 20261117 Migration 63. NEVER run directly against Production
-- without the separate migration/backup/rollback authorization gate.

CREATE TABLE IF NOT EXISTS tutor_private.v5_team_student_auth_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.v5_teams(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254 AND recipient_email = lower(btrim(recipient_email))),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by uuid REFERENCES auth.users(id),
  accepted_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  CONSTRAINT v59_invite_student_team_fk FOREIGN KEY (student_id,team_id)
    REFERENCES public.v5_team_students(id,team_id) ON DELETE RESTRICT,
  CONSTRAINT v59_invite_expiry CHECK (expires_at > created_at),
  CONSTRAINT v59_invite_accept_pair CHECK ((accepted_by IS NULL) = (accepted_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS v59_active_team_student_invitation
 ON tutor_private.v5_team_student_auth_invitations(team_id,student_id)
 WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS v59_invite_by_email
 ON tutor_private.v5_team_student_auth_invitations(recipient_email,expires_at)
 WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS tutor_private.v5_team_student_auth_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.v5_teams(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  invitation_id uuid NOT NULL UNIQUE REFERENCES tutor_private.v5_team_student_auth_invitations(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  CONSTRAINT v59_link_student_team_fk FOREIGN KEY(student_id,team_id)
    REFERENCES public.v5_team_students(id,team_id) ON DELETE RESTRICT,
  CONSTRAINT v59_link_revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS v59_one_active_auth_per_team_student
 ON tutor_private.v5_team_student_auth_links(team_id,student_id)
 WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS v59_one_active_student_per_auth_team
 ON tutor_private.v5_team_student_auth_links(team_id,auth_user_id)
 WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS v59_links_by_auth
 ON tutor_private.v5_team_student_auth_links(auth_user_id,team_id)
 WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS tutor_private.v5_team_student_auth_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.v5_teams(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  invitation_id uuid NOT NULL REFERENCES tutor_private.v5_team_student_auth_invitations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  event text NOT NULL CHECK (event IN ('invited','reinvited','accepted','invitation_revoked','link_revoked')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v59_audit_student_team_fk FOREIGN KEY(student_id,team_id)
    REFERENCES public.v5_team_students(id,team_id) ON DELETE RESTRICT
);

-- These identity/audit tables must never be queried directly by the browser.
ALTER TABLE tutor_private.v5_team_student_auth_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_private.v5_team_student_auth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_private.v5_team_student_auth_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tutor_private.v5_team_student_auth_invitations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON tutor_private.v5_team_student_auth_links FROM PUBLIC,anon,authenticated;
REVOKE ALL ON tutor_private.v5_team_student_auth_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE tutor_private.v5_team_student_auth_audit_id_seq FROM PUBLIC,anon,authenticated;

-- Manager-only invitation. A student cannot invite themself or choose a
-- different Team by passing arbitrary identifiers.
CREATE OR REPLACE FUNCTION public.v5_invite_team_student(
 p_student_id uuid, p_recipient_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := (select auth.uid());
 v_team uuid;
 v_email text := lower(btrim(coalesce(p_recipient_email,'')));
 v_old uuid;
 v_new uuid;
BEGIN
 IF v_actor IS NULL OR p_student_id IS NULL
   OR length(v_email) NOT BETWEEN 3 AND 254
   OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 THEN RAISE EXCEPTION '無效的學生或電子郵件' USING errcode='22023'; END IF;
 SELECT s.team_id INTO v_team
 FROM public.v5_team_students s
 JOIN public.v5_teams t ON t.id=s.team_id
 JOIN public.v5_team_governance g ON g.workspace_id=t.anchor_workspace_id
 JOIN public.v5_workspace_entitlements e ON e.workspace_id=g.workspace_id
 WHERE s.id=p_student_id AND NOT s.is_archived
   AND g.manager_user_id=v_actor AND e.plan_code='team';
 IF v_team IS NULL THEN RAISE EXCEPTION '無權邀請此 Team 學生' USING errcode='42501'; END IF;
 -- Lock Team to serialize replacement of expired invitations and active links.
 PERFORM 1 FROM public.v5_teams t WHERE t.id=v_team FOR UPDATE;
 IF EXISTS (SELECT 1 FROM tutor_private.v5_team_student_auth_links l
   WHERE l.team_id=v_team AND l.student_id=p_student_id AND l.revoked_at IS NULL)
 THEN RAISE EXCEPTION '此 Team 學生已有有效登入連結' USING errcode='23505'; END IF;
 -- Never silently replace a still-valid invitation for a different email.
 SELECT i.id INTO v_old FROM tutor_private.v5_team_student_auth_invitations i
 WHERE i.team_id=v_team AND i.student_id=p_student_id
  AND i.accepted_at IS NULL AND i.revoked_at IS NULL FOR UPDATE;
 IF v_old IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM tutor_private.v5_team_student_auth_invitations i
   WHERE i.id=v_old AND i.expires_at>now() AND i.recipient_email<>v_email)
  THEN RAISE EXCEPTION '已有待接受邀請，請先取消' USING errcode='23505'; END IF;
  UPDATE tutor_private.v5_team_student_auth_invitations
   SET revoked_at=now(),revoked_by=v_actor WHERE id=v_old;
  INSERT INTO tutor_private.v5_team_student_auth_audit
    (team_id,student_id,invitation_id,actor_id,event)
   VALUES(v_team,p_student_id,v_old,v_actor,'reinvited');
 END IF;
 INSERT INTO tutor_private.v5_team_student_auth_invitations
   (team_id,student_id,recipient_email,invited_by)
 VALUES(v_team,p_student_id,v_email,v_actor) RETURNING id INTO v_new;
 INSERT INTO tutor_private.v5_team_student_auth_audit
   (team_id,student_id,invitation_id,actor_id,event)
 VALUES(v_team,p_student_id,v_new,v_actor,'invited');
 RETURN jsonb_build_object('status','pending','invitation_id',v_new);
END $function$;

CREATE OR REPLACE FUNCTION public.v5_my_team_student_invitations()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=(select auth.uid()); v_email text; v_items jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 SELECT lower(email) INTO v_email FROM auth.users
 WHERE id=v_actor AND email_confirmed_at IS NOT NULL;
 IF v_email IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'student_name',s.display_name,'team_name',w.name,
  'expires_at',i.expires_at) ORDER BY i.created_at,i.id),'[]'::jsonb)
 INTO v_items
 FROM tutor_private.v5_team_student_auth_invitations i
 JOIN public.v5_team_students s ON s.id=i.student_id AND s.team_id=i.team_id
 JOIN public.v5_teams t ON t.id=i.team_id
 JOIN public.workspaces w ON w.id=t.anchor_workspace_id
 JOIN public.v5_workspace_entitlements e ON e.workspace_id=w.id
 WHERE i.recipient_email=v_email AND i.accepted_at IS NULL
   AND i.revoked_at IS NULL AND i.expires_at>now()
   AND NOT s.is_archived AND e.plan_code='team';
 RETURN v_items;
END $function$;

CREATE OR REPLACE FUNCTION public.v5_accept_team_student_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=(select auth.uid()); v_email text;
 v_invite tutor_private.v5_team_student_auth_invitations%rowtype;
 v_link uuid;
BEGIN
 IF v_actor IS NULL OR p_invitation_id IS NULL
 THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 SELECT lower(email) INTO v_email FROM auth.users
 WHERE id=v_actor AND email_confirmed_at IS NOT NULL;
 IF v_email IS NULL THEN RAISE EXCEPTION '請先驗證電子郵件' USING errcode='42501'; END IF;
 -- Read the Team key first without a row lock, then lock the Team.
 -- Invite replacement also locks Team before invitation; use one lock order
 -- to prevent invite/accept deadlocks. Re-read the invite FOR UPDATE below.
 SELECT * INTO v_invite FROM tutor_private.v5_team_student_auth_invitations
 WHERE id=p_invitation_id;
 IF NOT FOUND OR v_invite.recipient_email<>v_email
 THEN RAISE EXCEPTION '邀請不存在、非本人或已失效' USING errcode='42501'; END IF;
 PERFORM 1 FROM public.v5_teams t
 JOIN public.v5_workspace_entitlements e ON e.workspace_id=t.anchor_workspace_id
 JOIN public.v5_team_students s ON s.team_id=t.id AND s.id=v_invite.student_id
 WHERE t.id=v_invite.team_id AND e.plan_code='team' AND NOT s.is_archived
 FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Team 或學生已失效' USING errcode='42501'; END IF;
 SELECT * INTO v_invite FROM tutor_private.v5_team_student_auth_invitations
 WHERE id=p_invitation_id FOR UPDATE;
 IF NOT FOUND OR v_invite.recipient_email<>v_email
  OR v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL
  OR v_invite.expires_at<=now()
 THEN RAISE EXCEPTION '邀請不存在、非本人或已失效' USING errcode='42501'; END IF;
 IF EXISTS(SELECT 1 FROM tutor_private.v5_team_student_auth_links l
  WHERE l.revoked_at IS NULL AND l.team_id=v_invite.team_id
    AND (l.student_id=v_invite.student_id OR l.auth_user_id=v_actor))
 THEN RAISE EXCEPTION '目前 Team 已有有效學生連結' USING errcode='23505'; END IF;
 INSERT INTO tutor_private.v5_team_student_auth_links
  (team_id,student_id,auth_user_id,invitation_id)
 VALUES(v_invite.team_id,v_invite.student_id,v_actor,v_invite.id)
 RETURNING id INTO v_link;
 UPDATE tutor_private.v5_team_student_auth_invitations
 SET accepted_by=v_actor,accepted_at=now() WHERE id=v_invite.id;
 INSERT INTO tutor_private.v5_team_student_auth_audit
  (team_id,student_id,invitation_id,actor_id,event)
 VALUES(v_invite.team_id,v_invite.student_id,v_invite.id,v_actor,'accepted');
 RETURN jsonb_build_object('status','accepted','link_id',v_link);
END $function$;

CREATE OR REPLACE FUNCTION public.v5_my_team_student_links()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=(select auth.uid()); v_items jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',l.id,'student_name',s.display_name,'team_name',w.name)
   ORDER BY w.name,s.display_name),'[]'::jsonb) INTO v_items
 FROM tutor_private.v5_team_student_auth_links l
 JOIN public.v5_team_students s ON s.id=l.student_id AND s.team_id=l.team_id
 JOIN public.v5_teams t ON t.id=l.team_id
 JOIN public.workspaces w ON w.id=t.anchor_workspace_id
 JOIN public.v5_workspace_entitlements e ON e.workspace_id=w.id
 WHERE l.auth_user_id=v_actor AND l.revoked_at IS NULL
  AND e.plan_code='team' AND NOT s.is_archived;
 RETURN v_items;
END $function$;

-- Projection is deliberately the only student-facing lesson read path.
-- No teacher notes, private rate, money, payment or other students' PII.
CREATE OR REPLACE FUNCTION public.v5_my_team_student_lessons(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=(select auth.uid()); v_items jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 IF p_month IS NOT NULL AND p_month<>date_trunc('month',p_month::timestamp)::date
 THEN RAISE EXCEPTION '請使用月份第一天' USING errcode='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'subject',c.subject,'lesson_start',c.lesson_start,
  'lesson_end',c.lesson_end,'status',c.status,'project_name',c.project_name)
  ORDER BY c.lesson_start DESC,c.id),'[]'::jsonb) INTO v_items
 FROM (
  SELECT l.id,l.subject,l.lesson_start,l.lesson_end,l.status,p.name AS project_name
  FROM tutor_private.v5_team_student_auth_links a
  JOIN public.v5_team_students s ON s.id=a.student_id AND s.team_id=a.team_id
  JOIN public.v5_team_enrollments en ON en.student_id=a.student_id AND en.team_id=a.team_id
  JOIN public.v5_team_lessons l ON l.student_id=en.student_id
    AND l.team_id=en.team_id AND l.project_id=en.project_id
  JOIN public.v5_team_projects p ON p.id=l.project_id AND p.team_id=a.team_id
  JOIN public.v5_teams t ON t.id=a.team_id
  JOIN public.v5_workspace_entitlements e ON e.workspace_id=t.anchor_workspace_id
  WHERE a.auth_user_id=v_actor AND a.revoked_at IS NULL
   AND NOT s.is_archived AND e.plan_code='team'
   AND (p_month IS NULL OR
    (l.lesson_start >= p_month::timestamp AT TIME ZONE 'Asia/Taipei'
      AND l.lesson_start < (p_month::timestamp+interval '1 month') AT TIME ZONE 'Asia/Taipei'))
  ORDER BY l.lesson_start DESC,l.id
  LIMIT 150
 ) c;
 RETURN v_items;
END $function$;

CREATE OR REPLACE FUNCTION public.v5_team_student_manager_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=(select auth.uid()); v_students jsonb; v_pending jsonb; v_links jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.display_name,'team_name',w.name) ORDER BY w.name,s.display_name),'[]'::jsonb)
 INTO v_students FROM public.v5_team_students s
 JOIN public.v5_teams t ON t.id=s.team_id
 JOIN public.workspaces w ON w.id=t.anchor_workspace_id
 JOIN public.v5_team_governance g ON g.workspace_id=w.id
 JOIN public.v5_workspace_entitlements e ON e.workspace_id=w.id
 WHERE g.manager_user_id=v_actor AND e.plan_code='team' AND NOT s.is_archived;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',i.id,'student_name',s.display_name,'team_name',w.name,
   'recipient_email',i.recipient_email,'expires_at',i.expires_at)
   ORDER BY i.created_at),'[]'::jsonb) INTO v_pending
 FROM tutor_private.v5_team_student_auth_invitations i
 JOIN public.v5_team_students s ON s.id=i.student_id AND s.team_id=i.team_id
 JOIN public.v5_teams t ON t.id=i.team_id
 JOIN public.workspaces w ON w.id=t.anchor_workspace_id
 JOIN public.v5_team_governance g ON g.workspace_id=w.id
 WHERE g.manager_user_id=v_actor AND i.revoked_at IS NULL
  AND i.accepted_at IS NULL AND i.expires_at>now();
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',l.id,'student_name',s.display_name,'team_name',w.name)
  ORDER BY w.name,s.display_name),'[]'::jsonb) INTO v_links
 FROM tutor_private.v5_team_student_auth_links l
 JOIN public.v5_team_students s ON s.id=l.student_id AND s.team_id=l.team_id
 JOIN public.v5_teams t ON t.id=l.team_id
 JOIN public.workspaces w ON w.id=t.anchor_workspace_id
 JOIN public.v5_team_governance g ON g.workspace_id=w.id
 WHERE g.manager_user_id=v_actor AND l.revoked_at IS NULL;
 RETURN jsonb_build_object('students',v_students,'pending',v_pending,'links',v_links);
END $function$;

CREATE OR REPLACE FUNCTION public.v5_revoke_team_student_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=(select auth.uid()); v_invite tutor_private.v5_team_student_auth_invitations%rowtype;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 SELECT i.* INTO v_invite FROM tutor_private.v5_team_student_auth_invitations i
 JOIN public.v5_teams t ON t.id=i.team_id
 JOIN public.v5_team_governance g ON g.workspace_id=t.anchor_workspace_id
 WHERE i.id=p_invitation_id AND g.manager_user_id=v_actor
  AND i.revoked_at IS NULL AND i.accepted_at IS NULL FOR UPDATE OF i;
 IF NOT FOUND THEN RAISE EXCEPTION '無權取消此邀請' USING errcode='42501'; END IF;
 UPDATE tutor_private.v5_team_student_auth_invitations
 SET revoked_by=v_actor,revoked_at=now() WHERE id=v_invite.id;
 INSERT INTO tutor_private.v5_team_student_auth_audit
  (team_id,student_id,invitation_id,actor_id,event)
 VALUES(v_invite.team_id,v_invite.student_id,v_invite.id,v_actor,'invitation_revoked');
END $function$;

CREATE OR REPLACE FUNCTION public.v5_revoke_team_student_link(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=(select auth.uid());
 v_link tutor_private.v5_team_student_auth_links%rowtype;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION '請先登入' USING errcode='42501'; END IF;
 SELECT l.* INTO v_link FROM tutor_private.v5_team_student_auth_links l
 JOIN public.v5_teams t ON t.id=l.team_id
 JOIN public.v5_team_governance g ON g.workspace_id=t.anchor_workspace_id
 WHERE l.id=p_link_id AND g.manager_user_id=v_actor AND l.revoked_at IS NULL FOR UPDATE OF l;
 IF NOT FOUND THEN RAISE EXCEPTION '無權解除此學生連結' USING errcode='42501'; END IF;
 UPDATE tutor_private.v5_team_student_auth_links
 SET revoked_by=v_actor,revoked_at=now() WHERE id=v_link.id;
 INSERT INTO tutor_private.v5_team_student_auth_audit
  (team_id,student_id,invitation_id,actor_id,event)
 VALUES(v_link.team_id,v_link.student_id,v_link.invitation_id,v_actor,'link_revoked');
END $function$;

REVOKE ALL ON FUNCTION public.v5_invite_team_student(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_my_team_student_invitations() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_accept_team_student_invitation(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_my_team_student_links() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_my_team_student_lessons(date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_team_student_manager_overview() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_revoke_team_student_invitation(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v5_revoke_team_student_link(uuid) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.v5_invite_team_student(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_my_team_student_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_accept_team_student_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_my_team_student_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_my_team_student_lessons(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_team_student_manager_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_revoke_team_student_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v5_revoke_team_student_link(uuid) TO authenticated;
