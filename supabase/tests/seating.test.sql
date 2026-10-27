-- Database tests for seating, chips, clearing, sections, rotation, and audit (Phase 3).
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- A signed-in administrator to act as.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'host@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000aa', 'host', 'Host');

create temp table v (name text primary key, id bigint);
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function pg_temp.vid(p text) returns bigint language sql as $$ select id from v where name = p $$;
create function pg_temp.next_section() returns text language sql as $$ select next_section_code from public.rotation_state $$;
create function pg_temp.open_tables(p bigint) returns text language sql as $$
  select string_agg(t.code, '+' order by t.code) from public.visit_tables vt
  join public.restaurant_tables t on t.id = vt.table_id where vt.visit_id = p and vt.released_at is null $$;

-- Structure ---------------------------------------------------------------------------
select has_table('public', 'customer_visits', 'customer_visits exists');
select has_table('public', 'visit_tables', 'visit_tables exists');
select has_table('public', 'audit_events', 'audit_events exists');
select is(pg_temp.next_section(), 'A', 'rotation starts at A');

-- Seating one table --------------------------------------------------------------------
insert into v select 'a3', public.seat_party(array['A3'], 3, pg_temp.actor());
select is(pg_temp.open_tables(pg_temp.vid('a3')), 'A3', 'A3 is seated');
select is((select chips_status::text from public.customer_visits where id = pg_temp.vid('a3')), 'needed',
  'a new table needs chips (yellow)');
select is(pg_temp.next_section(), 'C', 'seating in A moves the rotation to C');

-- Double seating is refused ------------------------------------------------------------
select throws_ok($$ select public.seat_party(array['A3'], 2, pg_temp.actor()) $$,
  'P0001', 'table_occupied', 'a seated table cannot be seated again');
select throws_ok($$ select public.seat_party(array['A3', 'A4'], 8, pg_temp.actor()) $$,
  'P0001', 'table_occupied', 'a combination including a seated table is refused');
-- Even writing rows directly (skipping seat_party) cannot put a second open visit on A3.
with stray as (insert into public.customer_visits (guest_count) values (1) returning id)
insert into v select 'stray', id from stray;
select throws_ok(
  $$ insert into public.visit_tables (visit_id, table_id)
     select pg_temp.vid('stray'), id from public.restaurant_tables where code = 'A3' $$,
  '23505', null, 'the database itself allows only one open visit per table');

-- Closed sections ----------------------------------------------------------------------
select is(public.set_section_open('B', false, pg_temp.actor()), false, 'section B can be closed');
select throws_ok($$ select public.seat_party(array['B1'], 2, pg_temp.actor()) $$,
  'P0001', 'section_closed', 'a closed section cannot be seated');
select is((select count(*)::int from public.audit_events where event_type = 'section_closed' and section_code = 'B'), 1,
  'closing a section is recorded');
select is(public.set_section_open('B', true, pg_temp.actor()), true, 'section B can be opened again');
insert into v select 'b1', public.seat_party(array['B1'], 2, pg_temp.actor());
select is(pg_temp.open_tables(pg_temp.vid('b1')), 'B1', 'after opening, B1 can be seated');
select is(pg_temp.next_section(), 'X-1', 'seating in B moves the rotation to X(1)');

-- Party and Bar don't move the rotation ---------------------------------------------------
insert into v select 'party1', public.seat_party(array['PARTY-1'], 10, pg_temp.actor());
select is(pg_temp.next_section(), 'X-1', 'Party seating leaves the rotation where it was');
insert into v select 'bar1', public.seat_party(array['BAR-1'], 2, pg_temp.actor());
select is(pg_temp.next_section(), 'X-1', 'Bar seating leaves the rotation where it was');

-- Rotation wraps from P back to A ---------------------------------------------------------
insert into v select 'p1', public.seat_party(array['P1'], 2, pg_temp.actor());
select is(pg_temp.next_section(), 'A', 'after P the rotation starts again at A');

-- Combinations --------------------------------------------------------------------------
insert into v select 'c34', public.seat_party(array['C3', 'C4'], 9, pg_temp.actor(), 'C3+C4');
select is(pg_temp.open_tables(pg_temp.vid('c34')), 'C3+C4', 'an approved combination seats both tables');
select is((select tc.code from public.customer_visits cv join public.table_combinations tc on tc.id = cv.combination_id
           where cv.id = pg_temp.vid('c34')), 'C3+C4', 'the visit remembers which combination was used');
select throws_ok($$ select public.seat_party(array['X6', 'X7'], 14, pg_temp.actor(), 'X6+X7+X8') $$,
  'P0001', 'combination_mismatch', 'an approved combination must use exactly its tables');
insert into v select 'custom', public.seat_party(array['X1', 'X2'], 8, pg_temp.actor());
select is(pg_temp.open_tables(pg_temp.vid('custom')), 'X1+X2', 'anyone can join tables by hand');

-- Input checks ----------------------------------------------------------------------------
select throws_ok($$ select public.seat_party(array['A5'], 0, pg_temp.actor()) $$,
  'P0001', 'invalid_guest_count', 'at least one guest');
select throws_ok($$ select public.seat_party(array['A5', 'A5'], 2, pg_temp.actor()) $$,
  'P0001', 'duplicate_tables', 'a table cannot be picked twice');
select throws_ok($$ select public.seat_party(array['Z99'], 2, pg_temp.actor()) $$,
  'P0001', 'table_not_found', 'unknown tables are refused');
update public.restaurant_tables set is_active = false where code = 'P10';
select throws_ok($$ select public.seat_party(array['P10'], 2, pg_temp.actor()) $$,
  'P0001', 'table_inactive', 'inactive tables are refused');

-- Chips and clearing ----------------------------------------------------------------------
select throws_ok($$ select public.clear_visit(pg_temp.vid('a3'), 1, pg_temp.actor()) $$,
  'P0001', 'chips_not_served', 'a yellow table cannot be cleared');
select throws_ok($$ select public.mark_chips_served(pg_temp.vid('a3'), 7, pg_temp.actor()) $$,
  'P0001', 'stale_visit', 'a change from an out-of-date screen is refused');
select is(public.mark_chips_served(pg_temp.vid('a3'), 1, pg_temp.actor()), 2, 'chips served (red)');
select throws_ok($$ select public.mark_chips_served(pg_temp.vid('a3'), 2, pg_temp.actor()) $$,
  'P0001', 'chips_already_served', 'chips cannot be marked twice');
select is(public.clear_visit(pg_temp.vid('a3'), 2, pg_temp.actor()), 3, 'the chips runner clears the table');
select is(pg_temp.open_tables(pg_temp.vid('a3')), null, 'clearing releases the table (green)');
select throws_ok($$ select public.mark_chips_served(pg_temp.vid('a3'), 3, pg_temp.actor()) $$,
  'P0001', 'visit_closed', 'a cleared visit cannot be changed');
insert into v select 'a3_again', public.seat_party(array['A3'], 4, pg_temp.actor());
select isnt(pg_temp.vid('a3_again'), pg_temp.vid('a3'), 'the next group at A3 gets a new visit');

-- Audit history ---------------------------------------------------------------------------
select is((select count(*)::int from public.audit_events where visit_id = pg_temp.vid('a3')), 3,
  'seated, chips served, and cleared are all recorded for A3');
select throws_ok($$ update public.audit_events set details = '{}' $$,
  '42501', null, 'audit history cannot be edited');

-- Browsers cannot call the functions ------------------------------------------------------
set local role anon;
select throws_ok($$ select public.seat_party(array['A6'], 2, null) $$, '42501', null, 'anon cannot seat');
reset role;

select * from finish();
rollback;
