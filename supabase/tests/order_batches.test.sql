-- Database tests: one ticket per group, order batches, custom items, notes, kitchen receipts,
-- customer receipts, finalizing, and the order history.
begin;
create extension if not exists pgtap with schema extensions;

select plan(103);

alter sequence public.ticket_number_seq restart with 1001;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ba', 'orders@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000ba', 'orders', 'Orders test');
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000ba'::uuid $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.key(p integer) returns uuid language sql as $$ select ('00000000-0000-0000-0000-' || lpad(p::text, 12, '0'))::uuid $$;
create function pg_temp.line(p_name text, p_qty integer) returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.item(p_name), 'quantity', p_qty) $$;
create function pg_temp.custom(p_name text, p_cents integer, p_tax text, p_qty integer) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'price_cents', p_cents, 'tax_category', p_tax, 'quantity', p_qty) $$;

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
insert into ids select 'shift', public.start_shift(pg_temp.actor());
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
insert into ids select 'musfika', public.add_employee('02', 'Musfika', 'waiter', pg_temp.actor());
insert into ids select 'luis', public.add_employee('04', 'Luis', 'waiter', pg_temp.actor());
select public.update_employee(pg_temp.id('luis'), 'Luis', 'waiter', false, pg_temp.actor());
insert into ids select 'visit', public.seat_party(array['X2'], 4, pg_temp.actor());
create function pg_temp.save(p_key integer, p_employee text, p_lines jsonb, p_notes text default null)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_order(pg_temp.id('visit'), pg_temp.id(p_employee), pg_temp.key(p_key), p_lines, p_notes, 'America/Chicago', pg_temp.actor()) $$;
create function pg_temp.ticket() returns public.tickets language sql as $$ select * from public.tickets where visit_id = pg_temp.id('visit') and not legacy_single_order $$;

create temp table saved as select * from pg_temp.save(1, 'kafi', jsonb_build_array(pg_temp.line('Combo #5', 2), pg_temp.line('Domestic beer', 1)), '  No onions  ');

-- A first order starts the ticket ---------------------------------------------------------------------
select has_table('public', 'ticket_batches', 'ticket_batches exists');
select results_eq($$ select ticket_number, version, batch_no, already_saved from saved $$,
  $$ values (1001::bigint, 1, 1, false) $$, 'the first order starts ticket #1001 with order 1');
select results_eq($$ select employee_id, shift_id, status::text from public.tickets where ticket_number = 1001 $$,
  $$ select pg_temp.id('kafi'), pg_temp.id('shift'), 'open'::text $$, 'the ticket records the waiter and the shift');
select is((select notes from public.ticket_batches where ticket_id = (pg_temp.ticket()).id), 'No onions', 'the order note is saved, trimmed');
select results_eq($$ select item_name, quantity::integer, unit_price_cents, tax_group_code, is_custom from public.ticket_lines
                    where ticket_id = (pg_temp.ticket()).id order by line_no $$,
  $$ values ('Combo #5'::text, 2, 940, 'food'::text, false), ('Domestic beer', 1, 499, 'liquor', false) $$,
  'menu items and quantities save, with copied names, prices, and tax groups');

-- Repeated presses save once --------------------------------------------------------------------------------
select results_eq($$ select ticket_number, batch_no, already_saved from pg_temp.save(1, 'kafi', jsonb_build_array(pg_temp.line('Combo #5', 2))) $$,
  $$ values (1001::bigint, 1, true) $$, 'the same key returns the first save');
select is((select count(*)::int from public.ticket_batches where ticket_id = (pg_temp.ticket()).id), 1, '... and adds no order');
select is((select count(*)::int from public.ticket_lines where ticket_id = (pg_temp.ticket()).id), 2, '... and no lines');
select is((pg_temp.ticket()).version, 1, '... and doesn''t change the ticket');

-- More orders go on the same ticket ----------------------------------------------------------------------------
select results_eq($$ select ticket_number, version, batch_no, already_saved from pg_temp.save(2, 'musfika', jsonb_build_array(pg_temp.line('Taco', 1))) $$,
  $$ values (1001::bigint, 2, 2, false) $$, 'another waiter''s order is order 2 on the SAME ticket');
select is((select count(*)::int from public.tickets where visit_id = pg_temp.id('visit')), 1, 'still one ticket for the group');
select is((pg_temp.ticket()).employee_id, pg_temp.id('kafi'), 'the ticket stays with the waiter who started it');
select is((select employee_id from public.ticket_batches where batch_no = 2 and ticket_id = (pg_temp.ticket()).id), pg_temp.id('musfika'),
  'the order remembers who took it');
select is((select count(*)::int from (select distinct id from public.ticket_batches where ticket_id = (pg_temp.ticket()).id) b), 2, 'each order has its own ID');
select lives_ok($$ select * from pg_temp.save(3, 'kafi', jsonb_build_array(pg_temp.line('Taco', 3))) $$, 'the same item can be ordered again in a later order');

-- Custom items ---------------------------------------------------------------------------------------------------
select results_eq($$ select batch_no from pg_temp.save(4, 'kafi', jsonb_build_array(
    pg_temp.custom('Birthday flan', 450, 'food', 2), pg_temp.custom('House tequila shot', 700, 'cocktail', 1), pg_temp.line('Horchata', 1))) $$,
  $$ values (4) $$, 'custom items save alongside menu items');
select results_eq($$ select item_name, quantity::integer, unit_price_cents, tax_category_code, tax_group_code, is_custom, menu_item_id
                    from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id
                    where b.batch_no = 4 and l.is_custom order by l.line_no $$,
  $$ values ('Birthday flan'::text, 2, 450, 'food'::text, 'food'::text, true, null::bigint),
            ('House tequila shot', 1, 700, 'cocktail', 'liquor', true, null) $$,
  'name, price, quantity, and tax are saved; a liquor custom item gets the liquor tax');
select is((select count(*)::int from public.menu_items where name in ('Birthday flan', 'House tequila shot')), 0, 'a custom item never joins the menu');
select lives_ok($$ select * from pg_temp.save(5, 'kafi', jsonb_build_array(pg_temp.custom('On the house', 0, 'food', 1))) $$, 'a price of $0.00 is allowed');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.custom('Bad', -1, 'food', 1))) $$, 'P0001', 'invalid_custom_item', 'a negative price is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(jsonb_build_object('name', 'Bad', 'price_cents', 10.5, 'tax_category', 'food', 'quantity', 1))) $$,
  'P0001', 'invalid_custom_item', 'a fraction of a cent is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.custom('Bad', 1000001, 'food', 1))) $$, 'P0001', 'invalid_custom_item', 'an impossible price is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(jsonb_build_object('name', 'Bad', 'price_cents', 100, 'quantity', 1))) $$,
  'P0001', 'invalid_custom_item', 'a custom item with no tax category is refused (never guessed as food)');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.custom('Bad', 100, 'nope', 1))) $$, 'P0001', 'invalid_custom_item', 'an unknown tax category is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.custom('   ', 100, 'food', 1))) $$, 'P0001', 'invalid_custom_item', 'a blank name is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.custom('Bad', 100, 'food', 0))) $$, 'P0001', 'invalid_lines', 'quantity 0 is refused');

-- Other refusals -----------------------------------------------------------------------------------------------------
select throws_ok($$ select * from public.save_order(pg_temp.id('visit'), pg_temp.id('kafi'), null, jsonb_build_array(pg_temp.line('Taco', 1)), null, 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'missing_client_key', 'an order needs its key');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', '[]') $$, 'P0001', 'empty_ticket', 'an empty order is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.line('Taco', 1), pg_temp.line('Taco', 2))) $$, 'P0001', 'invalid_lines', 'the same item twice in one order is refused');
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.line('Taco', 1)), repeat('x', 501)) $$, 'P0001', 'invalid_notes', 'a very long note is refused');
select throws_ok($$ select * from pg_temp.save(6, 'luis', jsonb_build_array(pg_temp.line('Taco', 1))) $$, 'P0001', 'employee_inactive', 'a turned-off employee can''t order');
select public.update_menu_item(pg_temp.item('Taco'), 235, false, pg_temp.actor());
select throws_ok($$ select * from pg_temp.save(6, 'kafi', jsonb_build_array(pg_temp.line('Taco', 1))) $$, 'P0001', 'item_unavailable', 'a turned-off item can''t be ordered');
select public.update_menu_item(pg_temp.item('Taco'), 235, true, pg_temp.actor());
select throws_ok($$ insert into public.tickets (visit_id, employee_id) values (pg_temp.id('visit'), pg_temp.id('kafi')) $$,
  '23505', null, 'the database itself allows one active ticket per group');

-- Changing what is saved ---------------------------------------------------------------------------------------------
create function pg_temp.line_id(p_name text, p_batch integer) returns bigint language sql as $$
  select l.id from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id
   where l.item_name = p_name and b.batch_no = p_batch and l.ticket_id = (pg_temp.ticket()).id $$;
create function pg_temp.change(p_version integer, p_changes jsonb) returns integer language sql as $$
  select public.change_ticket((pg_temp.ticket()).id, p_version, pg_temp.id('musfika'), p_changes, pg_temp.actor()) $$;

select public.update_menu_item(pg_temp.item('Combo #5'), 1000, true, pg_temp.actor());
create temp table v (n integer);
insert into v select (pg_temp.ticket()).version;
select is(pg_temp.change((select n from v), jsonb_build_array(jsonb_build_object('op', 'quantity', 'line_id', pg_temp.line_id('Combo #5', 1), 'quantity', 3))),
  (select n + 1 from v), 'a quantity can change; the version moves on');
select results_eq($$ select quantity::integer, unit_price_cents from public.ticket_lines where id = pg_temp.line_id('Combo #5', 1) $$,
  $$ values (3, 940) $$, 'the line keeps its saved price after a menu change');
select throws_ok($$ select pg_temp.change((select n from v), jsonb_build_array(jsonb_build_object('op', 'quantity', 'line_id', pg_temp.line_id('Combo #5', 1), 'quantity', 9))) $$,
  'P0001', 'stale_ticket', 'a change from an older screen is refused: two waiters can''t overwrite each other');
select is((select quantity::integer from public.ticket_lines where id = pg_temp.line_id('Combo #5', 1)), 3, '... and the newer change stands');
select lives_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'remove', 'line_id', pg_temp.line_id('Taco', 2)))) $$, 'a line can be removed');
select lives_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'notes', 'batch_id', (select batch_id from saved), 'notes', 'Extra spicy'))) $$, 'a note can be edited');
select is((select notes from public.ticket_batches where id = (select batch_id from saved)), 'Extra spicy', '... and is saved');
select throws_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'quantity', 'line_id', 999999, 'quantity', 1))) $$,
  'P0001', 'line_not_found', 'an unknown line is refused');
select throws_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'quantity', 'line_id', pg_temp.line_id('Combo #5', 1), 'quantity', 100))) $$,
  'P0001', 'invalid_changes', 'quantity 100 is refused');
select is((select count(*)::int from public.audit_events where event_type = 'ticket_changed'), 3, 'every change is in the audit history');

-- Kitchen receipts --------------------------------------------------------------------------------------------------
create temp table kitchen as select * from public.request_kitchen_print((pg_temp.ticket()).id, null, pg_temp.id('kafi'), pg_temp.key(100), pg_temp.actor());
select is((select count(*)::int from kitchen), 4, 'unprinted orders with items are sent: orders 1, 3, 4, 5 (order 2 is now empty)');
select is((select string_agg(b.batch_no::text, ',' order by b.batch_no) from kitchen k join public.ticket_batches b on b.id = k.batch_id), '1,3,4,5', '... each its own attempt');
select is((pg_temp.ticket()).status::text, 'open', 'kitchen printing never locks the ticket');
select results_eq($$ select count(*)::int from public.request_kitchen_print((pg_temp.ticket()).id, null, pg_temp.id('kafi'), pg_temp.key(100), pg_temp.actor()) $$,
  $$ values (4) $$, 'the same press returns the same attempts');
select is((select count(*)::int from public.print_attempts where receipt_kind = 'kitchen' and ticket_id = (pg_temp.ticket()).id), 4, '... and records no more');
select throws_ok($$ select * from public.request_kitchen_print((pg_temp.ticket()).id, null, pg_temp.id('kafi'), pg_temp.key(101), pg_temp.actor()) $$,
  'P0001', 'nothing_to_print', 'while a print waits for an answer, it isn''t sent again by accident');
create function pg_temp.answer(p_attempt bigint, p_yes boolean) returns void language sql as $$
  select public.record_print_outcome(p_attempt, p_yes, pg_temp.id('kafi'), pg_temp.actor()) $$;
select pg_temp.answer((select attempt_id from kitchen order by attempt_id limit 1), true);
select ok((select kitchen_printed_at is not null from public.ticket_batches where id = (select batch_id from kitchen order by attempt_id limit 1)),
  'Yes marks the order as printed');
select pg_temp.answer(k.attempt_id, false) from kitchen k where k.attempt_id > (select min(attempt_id) from kitchen);
select results_eq($$ select b.batch_no from public.request_kitchen_print((pg_temp.ticket()).id, null, pg_temp.id('kafi'), pg_temp.key(102), pg_temp.actor()) r
                      join public.ticket_batches b on b.id = r.batch_id order by b.batch_no $$,
  $$ values (3), (4), (5) $$, 'orders that failed to print go again; the printed one does not');
select is((select kind::text from public.print_attempts a join public.ticket_batches b on b.id = a.batch_id where b.batch_no = 3 and a.attempt_no = 2), 'reprint', 'a second try counts as a reprint');
select pg_temp.answer(a.id, true) from public.print_attempts a where a.outcome = 'unknown' and a.receipt_kind = 'kitchen';
select results_eq($$ select count(*)::int from public.request_kitchen_print((pg_temp.ticket()).id, array[(select batch_id from saved)], pg_temp.id('kafi'), null, pg_temp.actor()) r
                     where r.is_reprint $$,
  $$ values (1) $$, 'a chosen order can be reprinted');
select pg_temp.answer(a.id, true) from public.print_attempts a where a.outcome = 'unknown' and a.receipt_kind = 'kitchen';
-- A new order after printing is the only one sent.
select * from pg_temp.save(7, 'kafi', jsonb_build_array(pg_temp.line('Flan (Mexican custard) (1)', 1)));
select results_eq($$ select b.batch_no from public.request_kitchen_print((pg_temp.ticket()).id, null, pg_temp.id('kafi'), pg_temp.key(103), pg_temp.actor()) r
                      join public.ticket_batches b on b.id = r.batch_id $$,
  $$ values (6) $$, 'only the new order goes to the kitchen');
select pg_temp.answer(a.id, true) from public.print_attempts a where a.outcome = 'unknown' and a.receipt_kind = 'kitchen';
select throws_ok($$ select * from public.request_kitchen_print((pg_temp.ticket()).id, array[999999::bigint], pg_temp.id('kafi'), null, pg_temp.actor()) $$,
  'P0001', 'batch_not_found', 'an order from nowhere is refused');
select throws_ok($$ select * from public.request_kitchen_print((pg_temp.ticket()).id, array[(select b.id from public.ticket_batches b where b.batch_no = 2 and b.ticket_id = (pg_temp.ticket()).id)], pg_temp.id('kafi'), null, pg_temp.actor()) $$,
  'P0001', 'empty_batch', 'an order with no items left can''t print');

-- The customer receipt ---------------------------------------------------------------------------------------------------
-- 3 x Combo #5 $28.20, 3 x Taco $7.05, 2 x flan $9.00, Horchata $3.25, On the house $0, Flan $3.75 = food $51.25
-- Domestic beer $4.99 + tequila shot $7.00 = liquor $11.99. Food tax $4.36, liquor tax $1.26. Total $68.86
create temp table first_try as select * from public.request_customer_receipt((pg_temp.ticket()).id, (pg_temp.ticket()).version, pg_temp.id('musfika'), pg_temp.key(200), pg_temp.actor());
select is((select receipt -> 'totals' from first_try),
  jsonb_build_object('food_subtotal_cents', 5125, 'liquor_subtotal_cents', 1199, 'food_rate_bp', 850, 'liquor_rate_bp', 1050,
                     'food_tax_cents', 436, 'liquor_tax_cents', 126, 'total_cents', 6886),
  'the bill includes every saved order, and each tax on its own subtotal');
select results_eq($$ select receipt ->> 'ticket_number', receipt ->> 'waiter_number', receipt ->> 'tables' from first_try $$,
  $$ values ('1001'::text, '01'::text, 'X2'::text) $$, 'the same ticket number as the kitchen receipts, the ticket''s waiter, the table');
select is((select count(*)::int from first_try, jsonb_array_elements(receipt -> 'lines') l where l ->> 'name' = 'Taco'), 1,
  'the same item from several orders is one line on the bill');
select is((select l from first_try, jsonb_array_elements(receipt -> 'lines') l where l ->> 'name' = 'Combo #5'),
  jsonb_build_object('name', 'Combo #5', 'quantity', 3, 'unit_cents', 940, 'total_cents', 2820, 'tax_group', 'food'),
  'each line has its quantity, price, and line total');
select is((pg_temp.ticket()).status::text, 'open', 'opening the print dialog doesn''t finalize');
select is((select outcome::text from public.print_attempts where id = (select attempt_id from first_try)), 'unknown', '... the attempt waits for an answer');
select results_eq($$ select attempt_id from public.request_customer_receipt((pg_temp.ticket()).id, (pg_temp.ticket()).version, pg_temp.id('musfika'), pg_temp.key(200), pg_temp.actor()) $$,
  $$ select attempt_id from first_try $$, 'the same press is the same attempt');

-- Failed or cancelled printing doesn't finalize.
select pg_temp.answer((select attempt_id from first_try), false);
select is((pg_temp.ticket()).status::text, 'open', 'No: the ticket stays open');
select is((select outcome::text from public.print_attempts where id = (select attempt_id from first_try)), 'not_printed', '... the failed attempt is on record');
select throws_ok($$ select pg_temp.answer((select attempt_id from first_try), true) $$, 'P0001', 'outcome_already_recorded', 'an answered attempt can''t be turned into a Yes');

-- The ticket changes after the receipt was made: that receipt can't finalize it.
create temp table second_try as select * from public.request_customer_receipt((pg_temp.ticket()).id, (pg_temp.ticket()).version, pg_temp.id('musfika'), pg_temp.key(201), pg_temp.actor());
select throws_ok($$ select * from public.request_customer_receipt((pg_temp.ticket()).id, 1, pg_temp.id('musfika'), pg_temp.key(299), pg_temp.actor()) $$,
  'P0001', 'stale_ticket', 'a bill from an older screen isn''t printed');
select * from pg_temp.save(8, 'kafi', jsonb_build_array(pg_temp.line('Sweet tea', 1)));
select throws_ok($$ select pg_temp.answer((select attempt_id from second_try), true) $$, 'P0001', 'stale_ticket', 'a Yes for an out-of-date bill is refused');
select is((pg_temp.ticket()).status::text, 'open', '... and the ticket is not finalized');
select lives_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'remove', 'line_id', pg_temp.line_id('Sweet tea', 7)))) $$, 'so the waiter can still fix the ticket');

-- Finalizing ----------------------------------------------------------------------------------------------------------------------
create temp table third_try as select * from public.request_customer_receipt((pg_temp.ticket()).id, (pg_temp.ticket()).version, pg_temp.id('musfika'), pg_temp.key(202), pg_temp.actor());
select public.record_print_outcome((select attempt_id from third_try), true, pg_temp.id('musfika'), pg_temp.actor());
select results_eq($$ select status::text, finalized_by_employee_id, total_cents, food_tax_cents, liquor_tax_cents from public.tickets where id = (pg_temp.ticket()).id $$,
  $$ select 'finalized'::text, pg_temp.id('musfika'), 6886::bigint, 436::bigint, 126::bigint $$, 'Yes finalizes: totals frozen');
select is((pg_temp.ticket()).final_receipt, (select receipt from third_try), 'the exact bill is kept');
select is((select outcome::text from public.print_attempts where id = (select attempt_id from third_try)), 'printed', 'the attempt is marked printed');
select lives_ok($$ select public.record_print_outcome((select attempt_id from third_try), true, pg_temp.id('musfika'), pg_temp.actor()) $$, 'answering Yes again is safe');
select is((select count(*)::int from public.audit_events where event_type = 'ticket_finalized'), 1, 'and finalizes only once');

-- After finalizing: nothing changes, anywhere -----------------------------------------------------------------------------------------
select throws_ok($$ select * from pg_temp.save(9, 'kafi', jsonb_build_array(pg_temp.line('Taco', 1))) $$, 'P0001', 'ticket_finalized', 'no more orders');
select is((select count(*)::int from public.tickets where visit_id = pg_temp.id('visit')), 1, '... and no new ticket for this group');
select throws_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'quantity', 'line_id', pg_temp.line_id('Combo #5', 1), 'quantity', 1))) $$,
  'P0001', 'ticket_finalized', 'no quantity changes');
select throws_ok($$ select pg_temp.change((pg_temp.ticket()).version, jsonb_build_array(jsonb_build_object('op', 'notes', 'batch_id', (select batch_id from saved), 'notes', 'x'))) $$,
  'P0001', 'ticket_finalized', 'no note changes');
select throws_ok($$ select public.cancel_ticket(pg_temp.id('visit'), (pg_temp.ticket()).id, (pg_temp.ticket()).version, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_finalized', 'it can''t be cancelled');
select throws_ok($$ select * from public.request_kitchen_print((pg_temp.ticket()).id, null, pg_temp.id('kafi'), null, pg_temp.actor()) $$,
  'P0001', 'ticket_finalized', 'no more kitchen receipts');
-- Even direct writes, skipping every function:
select throws_ok($$ update public.ticket_lines set unit_price_cents = 1 where ticket_id = (pg_temp.ticket()).id $$, 'P0001', 'ticket_finalized', 'the database refuses a direct price change');
select throws_ok($$ delete from public.ticket_lines where ticket_id = (pg_temp.ticket()).id $$, 'P0001', 'ticket_finalized', 'or deleting lines');
select throws_ok($$ insert into public.ticket_batches (ticket_id, batch_no, employee_id) values ((pg_temp.ticket()).id, 99, pg_temp.id('kafi')) $$, 'P0001', 'ticket_finalized', 'or adding an order');
select throws_ok($$ update public.ticket_batches set notes = 'x' where ticket_id = (pg_temp.ticket()).id $$, 'P0001', 'ticket_finalized', 'or changing a note');
select throws_ok($$ update public.tickets set total_cents = 1 where id = (pg_temp.ticket()).id $$, 'P0001', 'ticket_finalized', 'or changing the total');
select throws_ok($$ delete from public.tickets where id = (pg_temp.ticket()).id $$, 'P0001', 'ticket_finalized', 'or deleting the ticket');

-- Reprints -----------------------------------------------------------------------------------------------------------------------------
update public.tax_groups set rate_bp = 900 where code = 'food';
select public.update_menu_item(pg_temp.item('Taco'), 999, true, pg_temp.actor());
create temp table copy as select * from public.request_customer_receipt((pg_temp.ticket()).id, null, pg_temp.id('kafi'), null, pg_temp.actor());
select is((select receipt from copy), (select receipt from third_try), 'a reprint shows the exact same bill, after tax and menu changes');
select ok((select is_copy from copy), '... marked as a copy');
select pg_temp.answer((select attempt_id from copy), false);
select is((pg_temp.ticket()).status::text, 'finalized', 'a failed reprint changes nothing');
update public.tax_groups set rate_bp = 850 where code = 'food';

-- Clearing ------------------------------------------------------------------------------------------------------------------------------
select public.clear_visit(pg_temp.id('visit'),
  public.mark_chips_served(pg_temp.id('visit'), (select version from public.customer_visits where id = pg_temp.id('visit')), pg_temp.actor()),
  pg_temp.actor());
select is((select cleared_at is not null from public.customer_visits where id = pg_temp.id('visit')), true, 'the host can still clear a finalized table');
select lives_ok($$ select * from public.request_customer_receipt((pg_temp.ticket()).id, null, pg_temp.id('kafi'), null, pg_temp.actor()) $$, 'and the receipt can still be reprinted');

-- A ticket never finalized, then the table cleared: totals frozen, can still be billed.
insert into ids select 'visit2', public.seat_party(array['X3'], 2, pg_temp.actor());
create temp table open_ticket as select * from public.save_order(pg_temp.id('visit2'), pg_temp.id('kafi'), pg_temp.key(300), jsonb_build_array(pg_temp.line('Horchata', 1)), null, 'America/Chicago', pg_temp.actor());
select public.clear_visit(pg_temp.id('visit2'),
  public.mark_chips_served(pg_temp.id('visit2'), (select version from public.customer_visits where id = pg_temp.id('visit2')), pg_temp.actor()),
  pg_temp.actor());
update public.tax_groups set rate_bp = 900 where code = 'food';
select is((select food_tax_cents from public.ticket_totals where ticket_id = (select ticket_id from open_ticket)), 28::bigint,
  'clearing freezes an unfinalized ticket''s totals: a later rate change doesn''t move it ($3.25 at 8.5%)');
update public.tax_groups set rate_bp = 850 where code = 'food';
select throws_ok($$ select * from public.save_order(pg_temp.id('visit2'), pg_temp.id('kafi'), pg_temp.key(301), jsonb_build_array(pg_temp.line('Taco', 1)), null, 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'visit_closed', 'no more orders on a cleared table');

-- Tickets printed the old way --------------------------------------------------------------------------------------------------------------
insert into ids select 'visit3', public.seat_party(array['X4'], 2, pg_temp.actor());
insert into ids select 'old_ticket', ticket_id from public.save_ticket(pg_temp.id('visit3'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(pg_temp.line('Horchata', 2)), 'America/Chicago', pg_temp.actor());
select public.print_ticket(pg_temp.id('visit3'), pg_temp.id('old_ticket'), 1, pg_temp.id('kafi'), pg_temp.actor());
create temp table old_copy as select * from public.request_customer_receipt(pg_temp.id('old_ticket'), null, pg_temp.id('kafi'), null, pg_temp.actor());
select is((select receipt #>> '{totals,total_cents}' from old_copy), '705', 'a ticket printed the old way still reprints, from its frozen totals');
select ok((select is_copy from old_copy), '... as a copy');
select throws_ok($$ update public.ticket_lines set quantity = 1 where ticket_id = pg_temp.id('old_ticket') $$, 'P0001', 'ticket_finalized',
  'and the database now protects old printed tickets too');
select lives_ok($$ select * from public.save_order(pg_temp.id('visit3'), pg_temp.id('kafi'), pg_temp.key(400), jsonb_build_array(pg_temp.line('Taco', 1)), null, 'America/Chicago', pg_temp.actor()) $$,
  'a group with an old printed ticket can still order: it isn''t finalized the new way');

-- Order history ---------------------------------------------------------------------------------------------------------------------------
select results_eq($$ select ticket_number, employee_number, table_labels, total_cents, shift_id from public.ticket_history where ticket_number = 1001 $$,
  $$ select 1001::bigint, '01'::text, 'X2'::text, 6886::bigint, pg_temp.id('shift') $$, 'history shows the ticket, waiter, table, saved total, and shift');
select public.assign_duty('X-2', 'waiter', pg_temp.id('musfika'), pg_temp.actor());
select is((select employee_number from public.ticket_history where ticket_number = 1001), '01', 'a later section assignment doesn''t change the waiter shown');
select is((select total_cents from public.ticket_history where ticket_number = 1001), 6886::bigint, 'menu price changes didn''t change the history total');
select ok(not has_table_privilege('authenticated', 'public.ticket_history', 'select') and not has_table_privilege('anon', 'public.ticket_batches', 'select'),
  'browsers can''t read the history or the orders');
select ok(not has_function_privilege('authenticated', 'public.save_order(bigint, bigint, uuid, jsonb, text, text, uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.change_ticket(bigint, integer, bigint, jsonb, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.request_customer_receipt(bigint, integer, bigint, uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.request_kitchen_print(bigint, bigint[], bigint, uuid, uuid)', 'execute'),
  'browsers can''t order, change, or print');

select * from finish();
rollback;
