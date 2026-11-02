-- Database tests: orders belong to a table, separate from the Floor. A table has one open ticket, and
-- a finalized customer receipt frees it for a new one.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000bb', 'tables@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000bb', 'tables', 'Tables test');
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.key(p integer) returns uuid language sql as $$ select ('00000000-0000-0000-0001-' || lpad(p::text, 12, '0'))::uuid $$;
create function pg_temp.line(p_name text, p_qty integer) returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.item(p_name), 'quantity', p_qty) $$;

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
insert into ids select 'shift', public.start_shift(pg_temp.actor());
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
insert into ids select 'musfika', public.add_employee('02', 'Musfika', 'waiter', pg_temp.actor());

create function pg_temp.save(p_table text, p_key integer, p_employee text, p_item text)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order(p_table, pg_temp.id(p_employee), pg_temp.key(p_key), jsonb_build_array(pg_temp.line(p_item, 1)), null, 'America/Chicago', pg_temp.actor()) $$;
create function pg_temp.visits() returns bigint language sql as $$ select count(*) from public.customer_visits $$;
create function pg_temp.seated(p_table text) returns bigint language sql as $$
  select count(*) from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id where rt.code = p_table and vt.released_at is null $$;

-- A vacant table takes an order, and the Floor never hears about it ------------------------------------
select has_column('public', 'tickets', 'table_id', 'tickets belong to a table');
select col_is_null('public', 'tickets', 'visit_id', 'a ticket needs no visit');
select col_not_null('public', 'tickets', 'table_id', 'every ticket has a table');

create temp table visits_before as select pg_temp.visits() as n;
create temp table first_order as select * from pg_temp.save('A1', 1, 'kafi', 'Taco');
select is((select visit_id from public.tickets where id = (select ticket_id from first_order)), null::bigint, 'an order at a vacant table has no visit');
select is((select rt.code from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where t.id = (select ticket_id from first_order)), 'A1', 'and belongs to its table');
select is(pg_temp.visits(), (select n from visits_before), 'nobody got seated');
select is(pg_temp.seated('A1'), 0::bigint, 'the Floor still shows the table vacant');

-- One open ticket per table --------------------------------------------------------------------------
create temp table second_order as select * from pg_temp.save('A1', 2, 'musfika', 'Horchata');
select is((select ticket_id from second_order), (select ticket_id from first_order), 'another waiter''s order goes on the same ticket');
select is((select batch_no from second_order), 2, 'as order 2');
select is((select employee_id from public.ticket_batches where id = (select batch_id from second_order)), pg_temp.id('musfika'), 'with that waiter on it');
select is((select already_saved from pg_temp.save('A1', 2, 'musfika', 'Horchata')), true, 'pressing Save twice saves once');
select is((select count(*)::int from public.ticket_batches where ticket_id = (select ticket_id from first_order)), 2, 'still two orders');
select throws_ok($$ insert into public.tickets (table_id, employee_id) select table_id, employee_id from public.tickets where id = (select ticket_id from first_order) $$,
  '23505', null, 'the database refuses a second open ticket at a table');
select throws_ok($$ select * from pg_temp.save('NOPE', 3, 'kafi', 'Taco') $$, 'P0001', 'table_not_found', 'an unknown table is refused');
select isnt((select ticket_id from pg_temp.save('A2', 4, 'kafi', 'Taco')), (select ticket_id from first_order), 'another table has its own ticket');

-- A closed section's table can take an order --------------------------------------------------------
update public.sections set is_open = false where code = 'C';
select lives_ok($$ select * from pg_temp.save('C1', 5, 'kafi', 'Taco') $$, 'a closed section''s table still takes an order');
update public.sections set is_open = true where code = 'C';

-- Seating and clearing leave the order alone -----------------------------------------------------------
create temp table seated_order as select * from pg_temp.save('B1', 6, 'kafi', 'Taco');
insert into ids select 'visit', public.seat_party(array['B1'], 3, pg_temp.actor());
create temp table before_clear as select version, updated_at from public.tickets where id = (select ticket_id from seated_order);
create temp table after_seat as select * from pg_temp.save('B1', 7, 'kafi', 'Horchata');
select is((select ticket_id from after_seat), (select ticket_id from seated_order), 'seating doesn''t start a new ticket');
select is((select visit_id from public.tickets where id = (select ticket_id from seated_order)), null::bigint, 'and doesn''t tie the ticket to the group');
select is((select chips_status::text from public.customer_visits where id = pg_temp.id('visit')), 'needed', 'an order doesn''t change the chips');
select public.clear_visit(pg_temp.id('visit'),
  public.mark_chips_served(pg_temp.id('visit'), (select version from public.customer_visits where id = pg_temp.id('visit')), pg_temp.actor()),
  pg_temp.actor());
select is((select status::text from public.tickets where id = (select ticket_id from seated_order)), 'open', 'clearing the table leaves the ticket open');
select is((select total_cents from public.tickets where id = (select ticket_id from seated_order)), null::bigint, 'and doesn''t freeze its totals');
select is((select ticket_id from pg_temp.save('B1', 8, 'kafi', 'Taco')), (select ticket_id from seated_order), 'the next order still goes on it');

-- Everything else works without a visit ----------------------------------------------------------------
select lives_ok($$ select public.change_ticket((select ticket_id from first_order), (select version from public.tickets where id = (select ticket_id from first_order)), pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('op', 'notes', 'batch_id', (select batch_id from first_order), 'notes', 'No onions')), pg_temp.actor()) $$, 'lines and notes can change');
select is((select count(*)::int from public.request_kitchen_print((select ticket_id from first_order), null, pg_temp.id('kafi'), pg_temp.key(20), pg_temp.actor())), 2, 'kitchen receipts print');

create temp table bill as select * from public.request_customer_receipt((select ticket_id from first_order),
  (select version from public.tickets where id = (select ticket_id from first_order)), pg_temp.id('kafi'), pg_temp.key(21), pg_temp.actor());
select is((select receipt ->> 'tables' from bill), 'A1', 'the customer receipt names the table');
select is((select status::text from public.tickets where id = (select ticket_id from first_order)), 'open', 'asking for the receipt finalizes nothing');
select is((select table_labels from public.ticket_history where ticket_id = (select ticket_id from first_order)), 'A1', 'the history names the table');

-- The customer receipt resets the table ----------------------------------------------------------------
select public.record_print_outcome((select attempt_id from bill), true, pg_temp.id('kafi'), pg_temp.actor());
select is((select status::text from public.tickets where id = (select ticket_id from first_order)), 'finalized', 'Yes finalizes the ticket');
create temp table next_order as select * from pg_temp.save('A1', 9, 'kafi', 'Taco');
select isnt((select ticket_id from next_order), (select ticket_id from first_order), 'the next order starts a new ticket');
select ok((select ticket_number from next_order) > (select ticket_number from first_order), 'with the next number');
select is((select batch_no from next_order), 1, 'as order 1');
select is((select count(*)::int from public.ticket_lines where ticket_id = (select ticket_id from first_order)), 2, 'the finalized ticket keeps its lines');
select throws_ok($$ select public.change_ticket((select ticket_id from first_order), (select version from public.tickets where id = (select ticket_id from first_order)), pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('op', 'notes', 'batch_id', (select batch_id from first_order), 'notes', 'x')), pg_temp.actor()) $$, 'P0001', 'ticket_finalized', 'and stays locked');

-- Cancelling frees the table too ------------------------------------------------------------------------
select lives_ok($$ select public.cancel_order((select ticket_id from next_order), (select version from public.tickets where id = (select ticket_id from next_order)), pg_temp.id('kafi'), pg_temp.actor()) $$, 'an open ticket can be cancelled');
select isnt((select ticket_id from pg_temp.save('A1', 10, 'kafi', 'Taco')), (select ticket_id from next_order), 'and the next order starts a new ticket');

-- The previous build's call, by visit, keeps working -----------------------------------------------------
insert into ids select 'visit2', public.seat_party(array['B2'], 2, pg_temp.actor());
create temp table old_build as select * from public.save_order(pg_temp.id('visit2'), pg_temp.id('kafi'), pg_temp.key(30), jsonb_build_array(pg_temp.line('Taco', 1)), null, 'America/Chicago', pg_temp.actor());
select is((select visit_id from public.tickets where id = (select ticket_id from old_build)), pg_temp.id('visit2'), 'save_order finds its ticket through the visit');

-- Security -------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.save_table_order(text, bigint, uuid, jsonb, text, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancel_order(bigint, integer, bigint, uuid)', 'execute'), 'browsers can''t call the new functions');

select * from finish();
rollback;
