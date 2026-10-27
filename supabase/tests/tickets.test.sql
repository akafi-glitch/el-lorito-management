-- Database tests for tickets (Phase 7).
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000dd', 'host@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000dd', 'host', 'Host');

create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000dd'::uuid $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.lines(variadic p text[]) returns jsonb language sql as $$
  -- pairs: name, quantity, name, quantity...
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(p[i]), 'quantity', p[i + 1]::integer) order by i)
    from generate_series(1, array_length(p, 1), 2) i $$;
create function pg_temp.at(p text) returns timestamptz language sql as $$ select ('2026-10-27 ' || p || ' America/Chicago')::timestamptz $$;

create temp table ids (name text primary key, id bigint);
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
insert into ids select 'musfika', public.add_employee('02', 'Musfika', 'waiter', pg_temp.actor());
insert into ids select 'luis', public.add_employee('04', 'Luis', 'waiter', pg_temp.actor());
select public.update_employee((select id from ids where name = 'luis'), 'Luis', 'waiter', false, pg_temp.actor());
insert into ids select 'visit', public.seat_party(array['X2'], 4, pg_temp.actor());
insert into ids select 'other_visit', public.seat_party(array['B3'], 2, pg_temp.actor());
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;

create temp table saved (name text primary key, ticket_id bigint, ticket_number bigint, version integer);

-- Structure ----------------------------------------------------------------------------------
select has_table('public', 'tickets', 'tickets exists');
select has_table('public', 'ticket_lines', 'ticket_lines exists');

-- A new ticket --------------------------------------------------------------------------------
insert into saved select 't1', * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Combo #5', '2', 'Domestic beer', '1', 'Lunch #2', '1'), 'America/Chicago', pg_temp.actor(), pg_temp.at('14:59'));

select is((select ticket_number from saved where name = 't1'), 1001::bigint, 'ticket numbers start at 1001');
select is((select version from saved where name = 't1'), 1, 'a new ticket is version 1');
select results_eq($$ select item_name, quantity::integer, unit_price_cents, tax_group_code from public.ticket_lines
                    where ticket_id = (select ticket_id from saved where name = 't1') order by line_no $$,
  $$ values ('Combo #5'::text, 2, 940, 'food'::text), ('Domestic beer', 1, 499, 'liquor'), ('Lunch #2', 1, 799, 'food') $$,
  'lines keep the order shown, with copied names, prices, and tax groups');
select results_eq($$ select visit_id, employee_id, status::text from public.tickets where ticket_number = 1001 $$,
  $$ select pg_temp.id('visit'), pg_temp.id('kafi'), 'open'::text $$, 'the ticket belongs to the visit and to Kafi, open');

-- Late lunch price ----------------------------------------------------------------------------
insert into saved select 'late', * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Lunch #2', '1', 'Combo #5', '1'), 'America/Chicago', pg_temp.actor(), pg_temp.at('15:00'));
select results_eq($$ select unit_price_cents, late_surcharge_cents from public.ticket_lines
                    where ticket_id = (select ticket_id from saved where name = 'late') order by line_no $$,
  $$ values (899, 100), (940, 0) $$, 'from 3:00 PM a lunch item costs $1.00 more; others do not');
select is((select ticket_number from saved where name = 'late'), 1002::bigint, 'a second ticket for the same visit is 1002');
select is((select count(*)::int from public.tickets where visit_id = pg_temp.id('visit')), 2, 'both tickets belong to the same visit');

-- Editing ------------------------------------------------------------------------------------
select public.update_menu_item(pg_temp.item('Combo #5'), 1000, true, pg_temp.actor());
insert into saved select 't1v2', * from public.save_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 't1'), 1,
  pg_temp.id('musfika'), pg_temp.lines('Combo #5', '3', 'Lunch #2', '1', 'Taco', '2'), 'America/Chicago', pg_temp.actor(), pg_temp.at('16:00'));

select is((select version from saved where name = 't1v2'), 2, 'each save raises the version');
select results_eq($$ select item_name, quantity::integer, unit_price_cents from public.ticket_lines
                    where ticket_id = (select ticket_id from saved where name = 't1') order by line_no $$,
  $$ values ('Combo #5'::text, 3, 940), ('Lunch #2', 1, 799), ('Taco', 2, 235) $$,
  'kept lines keep their price (menu change, 3 PM); removed beer is gone; new taco priced now');
select results_eq($$ select employee_id, last_edited_by_employee_id from public.tickets where ticket_number = 1001 $$,
  $$ select pg_temp.id('kafi'), pg_temp.id('musfika') $$, 'the maker stays Kafi; the last editor is recorded');
select is((select ticket_number from saved where name = 't1v2'), 1001::bigint, 'editing keeps the ticket number');

select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 't1'), 1,
  pg_temp.id('kafi'), pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'stale_ticket', 'a save based on an older version is refused (another device saved first)');

select is((select details -> 'before' -> 1 ->> 'item' from public.audit_events
            where event_type = 'ticket_saved' and details ->> 'ticket' = '1001' and details ->> 'created' = 'false'),
  'Domestic beer', 'the audit history keeps the lines before the change');
select is((select count(*)::int from public.audit_events where event_type = 'ticket_saved'), 3, 'every save is recorded');

-- Refusals: the lines --------------------------------------------------------------------------
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'), '[]', 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'empty_ticket', 'an empty ticket is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1', 'Taco', '2'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'invalid_lines', 'the same item twice is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '0'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'invalid_lines', 'quantity 0 is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '100'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'invalid_lines', 'quantity 100 is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  '[{"item_id": 1, "quantity": 1.5}]', 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'invalid_lines', 'a fractional quantity is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  '[{"item_id": 1}]', 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'invalid_lines', 'a line without a quantity is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  '{"item_id": 1, "quantity": 1}', 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'invalid_lines', 'lines must be a list');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  '[{"item_id": 999999, "quantity": 1}]', 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'menu_item_not_found', 'unknown items are refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1'), null, pg_temp.actor()) $$, 'P0001', 'invalid_time', 'a missing time zone is refused');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1'), 'Mars/Olympus', pg_temp.actor()) $$, '22023', null, 'an unknown time zone is refused');

-- Availability ---------------------------------------------------------------------------------
select public.update_menu_item(pg_temp.item('Taco'), 235, false, pg_temp.actor());
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'item_unavailable', 'a turned-off item can''t be added');
select lives_ok($$ select * from public.save_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 't1'), 2,
  pg_temp.id('kafi'), pg_temp.lines('Combo #5', '3', 'Lunch #2', '1', 'Taco', '1'), 'America/Chicago', pg_temp.actor()) $$,
  'a turned-off item already on the ticket can stay (quantity changed)');
select public.update_menu_item(pg_temp.item('Taco'), 235, true, pg_temp.actor());

-- Refusals: who and where ----------------------------------------------------------------------
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('luis'),
  pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'employee_inactive', 'a turned-off employee can''t save');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, 987654,
  pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'employee_not_found', 'an unknown employee can''t save');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('other_visit'), (select ticket_id from saved where name = 't1'), 3,
  pg_temp.id('kafi'), pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'ticket_not_found', 'a ticket can''t be changed through another table''s visit');
select throws_ok($$ select * from public.save_ticket(424242, null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'visit_not_found', 'an unknown visit is refused');

-- Cancelling ----------------------------------------------------------------------------------
select is(public.cancel_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 'late'), 1, pg_temp.id('kafi'), pg_temp.actor()),
  1002::bigint, 'an open ticket can be cancelled');
select results_eq($$ select status::text, cancelled_by_employee_id from public.tickets where ticket_number = 1002 $$,
  $$ select 'cancelled'::text, pg_temp.id('kafi') $$, 'it stays, marked cancelled, with who cancelled it');
select is((select count(*)::int from public.ticket_lines where ticket_id = (select ticket_id from saved where name = 'late')), 2,
  'a cancelled ticket keeps its lines');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 'late'), 2,
  pg_temp.id('kafi'), pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'ticket_cancelled', 'a cancelled ticket can''t be changed');

-- Printed tickets are locked (printing itself is Phase 9) --------------------------------------
update public.tickets set status = 'printed', printed_at = now() where ticket_number = 1001;
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 't1'), 3,
  pg_temp.id('kafi'), pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'ticket_printed', 'a printed ticket can''t be changed');
select throws_ok($$ select public.cancel_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 't1'), 3, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_printed', 'a printed ticket can''t be cancelled');
select throws_ok($$ update public.tickets set printed_at = null where ticket_number = 1001 $$, '23514', null,
  'printed needs a print time (database rule)');

-- Clearing the table --------------------------------------------------------------------------
insert into saved select 'before_clear', * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Flan (Mexican custard) (1)', '2'), 'America/Chicago', pg_temp.actor());
select public.clear_visit(pg_temp.id('visit'),
  public.mark_chips_served(pg_temp.id('visit'), (select version from public.customer_visits where id = pg_temp.id('visit')), pg_temp.actor()),
  pg_temp.actor());
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), (select ticket_id from saved where name = 'before_clear'), 1,
  pg_temp.id('kafi'), pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'visit_closed', 'after the table is cleared its tickets can''t be changed');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor()) $$, 'P0001', 'visit_closed', 'or added to');
select is((select count(*)::int from public.tickets where visit_id = pg_temp.id('visit')), 3, 'clearing keeps every ticket');

insert into ids select 'next_visit', public.seat_party(array['X2'], 2, pg_temp.actor());
insert into saved select 'next', * from public.save_ticket(pg_temp.id('next_visit'), null, null, pg_temp.id('kafi'),
  pg_temp.lines('Taco', '1'), 'America/Chicago', pg_temp.actor());
select is((select count(*)::int from public.tickets where visit_id = pg_temp.id('next_visit')), 1,
  'the next group at X2 starts a new visit with only its own ticket');
select is((select ticket_number from saved where name = 'next'), 1004::bigint, 'ticket numbers keep counting');

-- Menu changes never touch saved tickets --------------------------------------------------------
select public.update_menu_item(pg_temp.item('Flan (Mexican custard) (1)'), 500, true, pg_temp.actor());
select is((select unit_price_cents from public.ticket_lines l join public.tickets t on t.id = l.ticket_id where t.ticket_number = 1003),
  375, 'a later price change leaves the saved ticket at $3.75');

-- Browsers --------------------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.tickets', 'select')
          and not has_table_privilege('authenticated', 'public.ticket_lines', 'select')
          and not has_function_privilege('authenticated', 'public.save_ticket(bigint, bigint, integer, bigint, jsonb, text, uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.cancel_ticket(bigint, bigint, integer, bigint, uuid)', 'execute'),
  'browsers can''t read tickets or save them');
select ok(has_function_privilege('service_role', 'public.save_ticket(bigint, bigint, integer, bigint, jsonb, text, uuid, timestamptz)', 'execute')
          and has_sequence_privilege('service_role', 'public.ticket_number_seq', 'usage'),
  'the server role can save tickets');
select ok(not has_sequence_privilege('anon', 'public.ticket_number_seq', 'usage'), 'browsers can''t use ticket numbers');

select * from finish();
rollback;
