-- Phase 12: security hardening before deployment.
--
-- Every table, view, and function already refuses browsers (each migration revokes them one by one;
-- the app reaches data only through the server). This migration closes what was left by default:
-- 1. The ID counters (sequences) still carried Supabase's default rights for the browser roles.
--    Browsers have no path to them through the API, but the rights are removed anyway.
-- 2. New tables, views, and sequences created later in the public schema no longer get browser
--    rights automatically. (New functions: Postgres lets anyone run one unless it is revoked, a rule
--    that can only be changed for every schema at once; each migration revokes its functions, and
--    supabase/tests/hardening.test.sql fails any pull request that leaves one open.)
-- 3. Supabase's helper public.rls_auto_enable() (created by a project setting, used by an event
--    trigger) was callable by browsers; that right is removed. The event trigger keeps working.
-- The server role keeps all of its rights.

revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
