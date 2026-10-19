-- Remove dangerous table-level privileges from browser roles: these bypass row-level protections.
revoke truncate, trigger, references on all tables in schema public from PUBLIC, anon, authenticated;
-- Browser only needs to propose a request, teacher approval changes these two status columns through review_family_request RPC.
revoke update on public.family_requests from PUBLIC, anon, authenticated;
grant update(status,reviewed_at) on public.family_requests to authenticated;
