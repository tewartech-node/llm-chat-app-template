-- Applied to tewartech-project-supabase (dcepcfnnqiwccbnnsdcq) 2026-08-01
-- via mcp__Supabase__apply_migration, name "security_hardening_chats_and_rls_auto_enable".
--
-- Fixes two WARN-level findings from get_advisors (security), found 2026-08-01:
--
-- 1. `chats` INSERT policy "authenticated members can create chats" used
--    WITH CHECK (true) -- fully permissive. `chats` itself carries no
--    sensitive/ownership columns (just id/created_at/updated_at; real access
--    control lives on chat_members via `user_id = auth.uid()`), so this was
--    never a data-exposure risk, but a bare `true` is still worth replacing
--    with an explicit, documented invariant rather than an accidental
--    blanket allow.
--
-- 2. `rls_auto_enable()` is a SECURITY DEFINER event-trigger function (fires
--    on CREATE TABLE to auto-enable RLS) that was, by omission, still
--    callable directly via PostgREST (/rest/v1/rpc/rls_auto_enable) by both
--    anon and authenticated. Event triggers fire with the function owner's
--    privileges regardless of role-level EXECUTE grants, so revoking EXECUTE
--    from PUBLIC/anon/authenticated closes the direct-RPC path without
--    affecting its real job (firing automatically on DDL).

DROP POLICY IF EXISTS "authenticated members can create chats" ON public.chats;
CREATE POLICY "authenticated members can create chats" ON public.chats
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
