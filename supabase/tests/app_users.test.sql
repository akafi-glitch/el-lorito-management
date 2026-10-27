-- Database tests for the app_users table. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select has_table('public', 'app_users', 'app_users table exists');
select col_is_pk('public', 'app_users', 'user_id', 'user_id is the primary key');
select has_column('public', 'app_users', 'is_active', 'app_users has is_active');
select hasnt_column('public', 'app_users', 'password', 'app_users stores no password');

select is(
  (select relrowsecurity from pg_class where oid = 'public.app_users'::regclass),
  true,
  'Row Level Security is enabled'
);

-- Two sign-in identities to attach accounts to.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'kafi@staff.ellorito-management.com'),
  ('00000000-0000-0000-0000-000000000002', 'other@staff.ellorito-management.com');

select lives_ok(
  $$ insert into public.app_users (user_id, username, display_name)
     values ('00000000-0000-0000-0000-000000000001', 'kafi', 'Kafi') $$,
  'a valid account can be created'
);

select throws_ok(
  $$ insert into public.app_users (user_id, username, display_name)
     values ('00000000-0000-0000-0000-000000000002', 'kafi', 'Duplicate') $$,
  '23505',
  null,
  'usernames must be unique'
);

select throws_ok(
  $$ insert into public.app_users (user_id, username, display_name)
     values ('00000000-0000-0000-0000-000000000002', 'Kafi Upper', 'Bad') $$,
  '23514',
  null,
  'usernames must be lowercase with no spaces'
);

-- Browser roles are refused outright.
set local role anon;
select throws_ok(
  $$ select * from public.app_users $$,
  '42501',
  null,
  'anon (signed-out browser) cannot read app_users'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ update public.app_users set is_active = true $$,
  '42501',
  null,
  'authenticated (signed-in browser) cannot change app_users'
);
reset role;

select * from finish();
rollback;
