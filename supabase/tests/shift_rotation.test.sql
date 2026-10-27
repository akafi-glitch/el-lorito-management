-- Database tests: a new shift starts the seating rotation again at A, and keeps everything else.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cc', 'shiftmgr@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000cc', 'shiftmgr', 'Shift Manager');

create temp table ids (name text primary key, id bigint);
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000cc'::uuid $$;
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.next_section() returns text language sql as $$ select next_section_code from public.rotation_state $$;
create function pg_temp.floor_version() returns bigint language sql as $$ select version from public.sync_versions where topic = 'floor' $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.occupied(p text) returns boolean language sql as $$
  select exists (select 1 from public.visit_tables vt join public.restaurant_tables t on t.id = vt.table_id
                 where t.code = p and vt.released_at is null) $$;
create temp table before (name text primary key, n bigint);
create function pg_temp.snap() returns void language sql as $$
  delete from before;
  insert into before values
    ('floor', (select version from public.sync_versions where topic = 'floor')),
    ('visits', (select count(*) from public.customer_visits)),
    ('visit_tables', (select count(*) from public.visit_tables)),
    ('tickets', (select count(*) from public.tickets)),
    ('shifts', (select count(*) from public.shifts)),
    ('assignments', (select count(*) from public.shift_assignments)),
    ('audit', (select count(*) from public.audit_events)) $$;
create function pg_temp.was(p text) returns bigint language sql as $$ select n from before where name = p $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

-- First shift ----------------------------------------------------------------------------------
select is(pg_temp.next_section(), 'A', 'the rotation starts at A');
select pg_temp.snap();
insert into ids select 'shift1', public.start_shift(pg_temp.actor());
select is(pg_temp.next_section(), 'A', 'starting a shift with the rotation at A leaves it at A');
select is(pg_temp.floor_version(), pg_temp.was('floor'), '... and doesn''t refresh the floor screens for nothing');

-- During the shift the rotation moves as usual ----------------------------------------------------
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
select public.assign_duty('A', 'waiter', pg_temp.id('kafi'), pg_temp.actor());
insert into ids select 'a2', public.seat_party(array['A2'], 4, pg_temp.actor());
select is(pg_temp.next_section(), 'C', 'seating in A moves the rotation to C');
insert into ids select 'c5', public.seat_party(array['C5'], 2, pg_temp.actor());
select is(pg_temp.next_section(), 'B', 'seating in C moves it to B');
select public.mark_chips_served(pg_temp.id('c5'), 1, pg_temp.actor());
insert into ids select 'ticket', ticket_id from public.save_ticket(pg_temp.id('a2'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 2)), 'America/Chicago', pg_temp.actor());

-- New shift: rotation back to A, nothing else lost --------------------------------------------------
select pg_temp.snap();
insert into ids select 'shift2', public.start_shift(pg_temp.actor());
select is(pg_temp.next_section(), 'A', 'a new shift puts the rotation back at A');
select ok(pg_temp.floor_version() > pg_temp.was('floor'), '... and refreshes the floor on every device');
select is((select details ->> 'rotation_next' from public.audit_events
           where event_type = 'shift_started' order by id desc limit 1), 'A', 'the history records the reset to A');

select ok(pg_temp.occupied('A2') and pg_temp.occupied('C5'), 'tables seated in the old shift stay seated');
select is((select chips_status::text from public.customer_visits where id = pg_temp.id('a2')), 'needed',
  'a table waiting for chips still waits for chips');
select is((select chips_status::text from public.customer_visits where id = pg_temp.id('c5')), 'served',
  'a table already served chips stays served');
select is((select count(*) from public.customer_visits), pg_temp.was('visits'), 'no visits deleted');
select is((select count(*) from public.visit_tables), pg_temp.was('visit_tables'), 'no seating history deleted');
select is((select count(*) from public.tickets), pg_temp.was('tickets'), 'no tickets deleted');
select is((select visit_id from public.tickets where id = pg_temp.id('ticket')), pg_temp.id('a2'),
  'the old shift''s ticket is still on its table');
select is((select count(*) from public.shifts), pg_temp.was('shifts') + 1, 'the old shift is kept; one new shift added');
select ok((select ended_at is not null from public.shifts where id = pg_temp.id('shift1')), 'the old shift is ended');
select is((select count(*) from public.shift_assignments), pg_temp.was('assignments'),
  'old assignments are ended, not deleted');
select is((select count(*) from public.audit_events), pg_temp.was('audit') + 1, 'history only grows');

-- The new shift's rotation carries on normally -------------------------------------------------------
insert into ids select 'a3', public.seat_party(array['A3'], 2, pg_temp.actor());
select is(pg_temp.next_section(), 'C', 'after the reset, seating in A moves the rotation to C');
insert into ids select 'party', public.seat_party(array['PARTY-1'], 10, pg_temp.actor());
select is(pg_temp.next_section(), 'C', 'Party seating still leaves the rotation where it was');
insert into ids select 'p1', public.seat_party(array['P1'], 2, pg_temp.actor());
select is(pg_temp.next_section(), 'A', 'after P the rotation still wraps to A');

-- A closed A doesn't stop the reset (suggestions skip closed sections, as before) ----------------------
select public.seat_party(array['B1'], 2, pg_temp.actor());
select public.set_section_open('A', false, pg_temp.actor());
select public.start_shift(pg_temp.actor());
select is(pg_temp.next_section(), 'A', 'the reset points at A even while A is closed');
select public.set_section_open('A', true, pg_temp.actor());

select ok(not has_function_privilege('anon', 'public.start_shift(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.start_shift(uuid)', 'execute'),
  'browsers still can''t start a shift');

select * from finish();
rollback;
