-- Database tests for live updates (Phase 10).
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'live@staff.ellorito-management.com'),
  ('00000000-0000-0000-0000-00000000aa02', 'gone@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values
  ('00000000-0000-0000-0000-00000000aa01', 'live', 'Live'),
  ('00000000-0000-0000-0000-00000000aa02', 'gone', 'Gone');
update public.app_users set is_active = false where username = 'gone';
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-00000000aa01'::uuid $$;
create function pg_temp.v(p text) returns bigint language sql as $$ select version from public.sync_versions where topic = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create temp table before as select topic, version from public.sync_versions;
create function pg_temp.moved(p text) returns bigint language sql as $$
  select (select version from public.sync_versions where topic = p) - (select version from before where topic = p) $$;
create function pg_temp.snap() returns void language sql as $$
  delete from before; insert into before select topic, version from public.sync_versions $$;

-- Capture the live signals instead of sending them (this replacement is rolled back at the end).
-- Mirrors send_live_signal: realtime.send(payload, event = topic, channel = 'restaurant', private).
create table pg_temp.sent (payload jsonb, event text, topic text, private boolean);
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$
  insert into pg_temp.sent values (jsonb_build_object('topic', p_topic, 'version', p_version), p_topic, 'restaurant', true) $$;

select has_table('public', 'sync_versions', 'sync_versions exists');
select results_eq($$ select topic from public.sync_versions order by topic $$,
  array['floor', 'menu', 'staff', 'tickets'], 'four topics: floor, menu, staff, tickets');

-- Floor -----------------------------------------------------------------------------------------
create temp table ids (name text primary key, id bigint);
insert into ids select 'visit', public.seat_party(array['A2'], 2, pg_temp.actor());
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
select ok(pg_temp.moved('floor') > 0, 'seating moves the floor version');
select is(pg_temp.moved('tickets'), 0::bigint, '... and not the tickets version');
select results_eq($$ select event, topic, private, payload ->> 'topic' from pg_temp.sent order by ctid desc limit 1 $$,
  $$ values ('floor'::text, 'restaurant'::text, true, 'floor'::text) $$, 'a private live signal "floor" goes to the restaurant channel');
select is((select payload - 'topic' - 'version' from pg_temp.sent order by ctid desc limit 1), '{}'::jsonb,
  'the signal carries only the topic and version, no restaurant data');
select is((select (payload ->> 'version')::bigint from pg_temp.sent where event = 'floor' order by ctid desc limit 1), pg_temp.v('floor'),
  'the signal names the new version');

select pg_temp.snap();
select public.mark_chips_served(pg_temp.id('visit'), 1, pg_temp.actor());
select ok(pg_temp.moved('floor') > 0, 'chips served moves the floor version');
select pg_temp.snap();
select public.set_section_open('P', false, pg_temp.actor());
select ok(pg_temp.moved('floor') > 0, 'closing a section moves the floor version');

-- Staff -----------------------------------------------------------------------------------------
select pg_temp.snap();
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
select ok(pg_temp.moved('staff') > 0, 'adding an employee moves the staff version');
select pg_temp.snap();
select public.start_shift(pg_temp.actor());
select ok(pg_temp.moved('staff') > 0 and pg_temp.moved('floor') > 0,
  'a new shift moves the staff version, and the floor version (the rotation goes back to A)');
select pg_temp.snap();
select public.assign_duty('A', 'waiter', pg_temp.id('kafi'), pg_temp.actor());
select ok(pg_temp.moved('staff') > 0, 'an assignment moves the staff version');
select is(pg_temp.moved('floor'), 0::bigint, '... and not the floor version');

-- Menu ------------------------------------------------------------------------------------------
select pg_temp.snap();
select public.update_menu_item(pg_temp.item('Taco'), 250, true, pg_temp.actor());
select ok(pg_temp.moved('menu') > 0, 'a price change moves the menu version');

-- Tickets ---------------------------------------------------------------------------------------
select pg_temp.snap();
insert into ids select 'ticket', ticket_id from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1)), 'America/Chicago', pg_temp.actor());
select ok(pg_temp.moved('tickets') > 0, 'saving a ticket moves the tickets version');
select pg_temp.snap();
select public.print_ticket(pg_temp.id('visit'), pg_temp.id('ticket'), 1, pg_temp.id('kafi'), pg_temp.actor());
select ok(pg_temp.moved('tickets') > 0, 'printing moves the tickets version');

-- A failed save changes nothing ---------------------------------------------------------------------
select pg_temp.snap();
select throws_ok($$ select public.seat_party(array['A2'], 2, pg_temp.actor()) $$, 'P0001', 'table_occupied', 'seating a taken table is refused');
select is(pg_temp.moved('floor'), 0::bigint, 'a refused change sends no signal and moves no version');

-- A broken live service never blocks the restaurant ----------------------------------------------------
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language plpgsql as $$ begin raise exception 'realtime is down'; end $$;
select pg_temp.snap();
select lives_ok($$ select public.seat_party(array['A3'], 2, pg_temp.actor()) $$, 'seating still works when the live signal fails');
select ok(pg_temp.moved('floor') > 0, '... and the version still moves, so screens catch up');

-- Who may hear it ----------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa01', true);
select ok(private.is_active_staff(), 'an active administrator may hear the live signals');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa02', true);
select ok(not private.is_active_staff(), 'a turned-off account may not');

select ok(not has_table_privilege('anon', 'public.sync_versions', 'select')
          and not has_table_privilege('authenticated', 'public.sync_versions', 'select')
          and not has_function_privilege('anon', 'private.is_active_staff()', 'execute')
          and not has_function_privilege('authenticated', 'public.note_change()', 'execute'),
  'browsers can''t read the versions or call the helpers');

select ok(not has_function_privilege('authenticated', 'public.send_live_signal(text, bigint)', 'execute')
          and not has_function_privilege('anon', 'public.send_live_signal(text, bigint)', 'execute'),
  'browsers can''t send live signals');

select * from finish();
rollback;
