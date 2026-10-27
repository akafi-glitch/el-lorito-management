-- Database tests for the deployment hardening (Phase 12): nothing in the public schema is open to browsers.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'every table has Row Level Security on');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            cross join (values ('anon'), ('authenticated')) r (role)
            where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
              and (has_table_privilege(r.role, c.oid, 'select') or has_table_privilege(r.role, c.oid, 'insert')
                   or has_table_privilege(r.role, c.oid, 'update') or has_table_privilege(r.role, c.oid, 'delete'))), 0,
  'browsers can''t read or change any table or view');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            cross join (values ('anon'), ('authenticated')) r (role)
            where n.nspname = 'public' and c.relkind = 'S'
              and (has_sequence_privilege(r.role, c.oid, 'select') or has_sequence_privilege(r.role, c.oid, 'usage')
                   or has_sequence_privilege(r.role, c.oid, 'update'))), 0,
  'browsers can''t read or use any ID counter');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            cross join (values ('anon'), ('authenticated')) r (role)
            where n.nspname = 'public' and has_function_privilege(r.role, p.oid, 'execute')), 0,
  'browsers can''t run any function in the public schema');

select is((select string_agg(p.proname::text, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')),
  'is_active_staff', 'the only thing a signed-in browser may run: "am I an active administrator?" (for live updates)');

-- Things created later get no browser rights by default.
create table public.zz_later (id integer primary key);
create sequence public.zz_later_seq;
select ok(not has_table_privilege('anon', 'public.zz_later', 'select') and not has_table_privilege('authenticated', 'public.zz_later', 'select'),
  'a table added later is closed to browsers by default');
select ok(not has_sequence_privilege('authenticated', 'public.zz_later_seq', 'usage'), 'a counter added later is closed to browsers by default');
-- New functions: Postgres lets anyone run a new function unless it is revoked (a rule that can only
-- be changed for every schema at once). Each migration revokes its functions, and test 4 above fails
-- the pull request if one is ever left open.

select * from finish();
rollback;
