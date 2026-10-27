-- Database tests for employees, shifts, and assignments (Phase 4).
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000bb', 'mgr@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000bb', 'mgr', 'Manager');

create temp table e (name text primary key, id bigint);
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;
create function pg_temp.eid(p text) returns bigint language sql as $$ select id from e where name = p $$;
create function pg_temp.on_section(p_section text, p_duty text) returns text language sql as $$
  select string_agg(full_name, ', ') from public.current_assignments where section_code = p_section and duty::text = p_duty $$;

-- Structure and roles --------------------------------------------------------------------
select has_table('public', 'employees', 'employees exists');
select has_table('public', 'shifts', 'shifts exists');
select has_table('public', 'shift_assignments', 'shift_assignments exists');
select results_eq($$ select name from public.employee_roles order by sort_order $$,
  array['Waiter', 'Chips runner', 'Manager'], 'roles are waiter, chips runner, manager');

-- Employees -------------------------------------------------------------------------------
insert into e select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
insert into e select 'jesus', public.add_employee('02', 'Jesus', 'waiter', pg_temp.actor());
insert into e select 'abdullah', public.add_employee('03', 'Abdullah', 'chips_runner', pg_temp.actor());
insert into e select 'rene', public.add_employee('04', 'Rene', 'chips_runner', pg_temp.actor());
insert into e select 'maria', public.add_employee('05', 'Maria', 'manager', pg_temp.actor());

select is((select count(*)::int from public.employees), 5, 'five employees added');
select throws_ok($$ select public.add_employee('1', 'Someone', 'waiter', pg_temp.actor()) $$,
  'P0001', 'employee_number_taken', '"1" is taken because "01" exists');
select throws_ok($$ select public.add_employee('A1', 'Someone', 'waiter', pg_temp.actor()) $$,
  '23514', null, 'employee numbers are digits only');
select throws_ok($$ select public.add_employee('09', '   ', 'waiter', pg_temp.actor()) $$,
  '23514', null, 'a name is required');
select throws_ok($$ select public.add_employee('09', 'Someone', 'host', pg_temp.actor()) $$,
  '23503', null, 'only the three roles exist');
select is((select full_name from public.employees where number_key = '1'), 'Kafi',
  'typing 1 or 01 finds the same person');

-- Shifts ----------------------------------------------------------------------------------
select throws_ok($$ select public.assign_duty('A', 'waiter', pg_temp.eid('kafi'), pg_temp.actor()) $$,
  'P0001', 'no_open_shift', 'assignments need an open shift');
select isnt(public.start_shift(pg_temp.actor()), null, 'a shift can be started');

-- Assign and reassign (the Kafi X(1) to B example) -----------------------------------------
select lives_ok($$ select public.assign_duty('X-1', 'waiter', pg_temp.eid('kafi'), pg_temp.actor()) $$,
  'Kafi is assigned to X(1)');
select is(pg_temp.on_section('X-1', 'waiter'), 'Kafi', 'X(1) waiter is Kafi');
select lives_ok($$ select public.assign_duty('X-1', 'waiter', null, pg_temp.actor());
                   select public.assign_duty('B', 'waiter', pg_temp.eid('kafi'), pg_temp.actor()) $$,
  'Kafi is moved to B');
select is((select string_agg(section_name, ', ') from public.current_assignments where employee_id = pg_temp.eid('kafi')),
  'B', 'the latest assignment is B');
select is((select count(*)::int from public.shift_assignments where employee_id = pg_temp.eid('kafi') and section_code = 'X-1' and ended_at is not null),
  1, 'history keeps the earlier X(1) assignment');
select lives_ok($$ select public.assign_duty('B', 'waiter', pg_temp.eid('jesus'), pg_temp.actor()) $$,
  'B can be handed to Jesus');
select is(pg_temp.on_section('B', 'waiter'), 'Jesus', 'only one waiter per section: B is now Jesus');

-- Who may hold which duty --------------------------------------------------------------------
select throws_ok($$ select public.assign_duty('A', 'waiter', pg_temp.eid('abdullah'), pg_temp.actor()) $$,
  'P0001', 'role_mismatch', 'a chips runner cannot be a section waiter');
select lives_ok($$ select public.assign_duty('A', 'waiter', pg_temp.eid('maria'), pg_temp.actor());
                   select public.assign_duty('C', 'chips_runner', pg_temp.eid('maria'), pg_temp.actor()) $$,
  'a manager can take either duty');
select throws_ok($$ select public.assign_duty('BAR', 'waiter', pg_temp.eid('kafi'), pg_temp.actor()) $$,
  'P0001', 'bar_open_to_all', 'the Bar has no assigned waiter (any waiter can bill it)');

-- Chips runners: Runner 1 on A, B, C; Runner 2 on X(1), X(2), P, Party -----------------------
select lives_ok($$
  select public.assign_duty(s, 'chips_runner', pg_temp.eid('abdullah'), pg_temp.actor()) from unnest(array['A','B','C']) s;
  select public.assign_duty(s, 'chips_runner', pg_temp.eid('rene'), pg_temp.actor()) from unnest(array['X-1','X-2','P','PARTY']) s $$,
  'two runners cover their sections');
select is((select string_agg(section_name, ', ' order by section_name) from public.current_assignments where full_name = 'Rene'),
  'P, Party, X(1), X(2)', 'Runner 2 covers X(1), X(2), P, and Party');

select throws_ok(
  $$ insert into public.shift_assignments (shift_id, section_code, duty, employee_id)
     select id, 'B', 'waiter', pg_temp.eid('kafi') from public.shifts where ended_at is null $$,
  '23505', null, 'the database allows only one active waiter per section');

-- Turning someone off or changing their role ------------------------------------------------
select lives_ok($$ select public.update_employee(pg_temp.eid('jesus'), 'Jesus', 'waiter', false, pg_temp.actor()) $$,
  'Jesus can be turned off');
select is(pg_temp.on_section('B', 'waiter'), null, 'turning Jesus off ends his duty on B');
select throws_ok($$ select public.assign_duty('B', 'waiter', pg_temp.eid('jesus'), pg_temp.actor()) $$,
  'P0001', 'employee_inactive', 'a turned-off employee cannot be assigned');
select lives_ok($$ select public.update_employee(pg_temp.eid('abdullah'), 'Abdullah', 'waiter', true, pg_temp.actor()) $$,
  'Abdullah becomes a waiter');
select is((select count(*)::int from public.current_assignments where full_name = 'Abdullah'), 0,
  'his chips-runner duties ended with the role change');

-- New shift --------------------------------------------------------------------------------
select public.start_shift(pg_temp.actor());
select is((select count(*)::int from public.current_assignments), 0, 'a new shift starts with no assignments');

-- Browsers are refused -----------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.employees $$, '42501', null, 'anon cannot read employees');
reset role;

select * from finish();
rollback;
