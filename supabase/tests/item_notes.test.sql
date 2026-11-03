-- Database tests: each item of an order can have its own note, and it follows the same rules as the rest of the order.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.save(p_table text, p_lines jsonb)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order(p_table, pg_temp.id('kafi'), gen_random_uuid(), p_lines, null, 'America/Chicago', null) $$;
create function pg_temp.note(p_ticket bigint, p_name text) returns text language sql as $$
  select notes from public.ticket_lines where ticket_id = p_ticket and item_name = p_name order by id limit 1 $$;
create function pg_temp.line(p_ticket bigint, p_name text) returns bigint language sql as $$
  select id from public.ticket_lines where ticket_id = p_ticket and item_name = p_name order by id limit 1 $$;
create function pg_temp.change(p_ticket bigint, p_changes jsonb) returns integer language sql as $$
  select public.change_ticket(p_ticket, (select version from public.tickets where id = p_ticket), pg_temp.id('kafi'), p_changes, null) $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

insert into ids select 'kafi', public.add_employee('77002', 'Note Waiter', 'waiter', null);
select public.start_shift(null);

-- Saving ---------------------------------------------------------------------------------------------
insert into ids select 'ticket', ticket_id from pg_temp.save('C1', jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 2, 'notes', '  No onions  '),
  jsonb_build_object('item_id', pg_temp.item('Horchata'), 'quantity', 1, 'notes', 'Extra ice'),
  jsonb_build_object('item_id', pg_temp.item('Domestic beer'), 'quantity', 1, 'notes', null),
  jsonb_build_object('name', 'Birthday flan', 'price_cents', 450, 'tax_category', 'food', 'quantity', 1, 'notes', 'Add a candle'),
  jsonb_build_object('item_id', pg_temp.item('Lunch #3'), 'quantity', 1, 'notes', '   ')));

select is(pg_temp.note(pg_temp.id('ticket'), 'Taco'), 'No onions', 'an item keeps its own note, without spare spaces');
select is(pg_temp.note(pg_temp.id('ticket'), 'Horchata'), 'Extra ice', 'the next item keeps its own');
select is(pg_temp.note(pg_temp.id('ticket'), 'Domestic beer'), null, 'an item can have no note');
select is(pg_temp.note(pg_temp.id('ticket'), 'Birthday flan'), 'Add a candle', 'a custom item can have a note');
select is(pg_temp.note(pg_temp.id('ticket'), 'Lunch #3'), null, 'a blank note counts as no note');
select ok((select details -> 'lines' -> 0 ->> 'notes' = 'No onions' from public.audit_events where event_type = 'order_saved' order by id desc limit 1),
  'the history records the note');

select throws_ok($$ select * from pg_temp.save('C2', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1, 'notes', repeat('x', 201)))) $$,
  'invalid_notes', 'a note over 200 characters is refused');
select throws_ok($$ select * from pg_temp.save('C2', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1, 'notes', 5))) $$,
  'invalid_notes', 'a note must be text');
select lives_ok($$ select * from pg_temp.save('C3', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1, 'notes', repeat('x', 200)))) $$,
  'a note of exactly 200 characters is fine');
select lives_ok($$ select * from pg_temp.save('C4', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1))) $$,
  'a line needs no note at all, as the older app sends it');

-- Changing -------------------------------------------------------------------------------------------
select pg_temp.change(pg_temp.id('ticket'), jsonb_build_array(jsonb_build_object('op', 'line_notes', 'line_id', pg_temp.line(pg_temp.id('ticket'), 'Taco'), 'notes', 'Extra spicy')));
select is(pg_temp.note(pg_temp.id('ticket'), 'Taco'), 'Extra spicy', 'a saved item''s note can be changed');
select is(pg_temp.note(pg_temp.id('ticket'), 'Horchata'), 'Extra ice', '... and the others stay as they are');
select pg_temp.change(pg_temp.id('ticket'), jsonb_build_array(jsonb_build_object('op', 'line_notes', 'line_id', pg_temp.line(pg_temp.id('ticket'), 'Taco'), 'notes', ' ')));
select is(pg_temp.note(pg_temp.id('ticket'), 'Taco'), null, 'clearing it removes the note');

select throws_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_array(jsonb_build_object('op', 'line_notes', 'line_id', 999999999, 'notes', 'x'))) $$,
  'line_not_found', 'a line that isn''t on this ticket is refused');
select throws_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_array(jsonb_build_object('op', 'line_notes', 'line_id', pg_temp.line(pg_temp.id('ticket'), 'Horchata'), 'notes', repeat('x', 201)))) $$,
  'invalid_notes', 'a changed note has the same limit');

-- The customer's bill, and a finished ticket ----------------------------------------------------------
insert into ids select 'attempt', attempt_id from public.request_customer_receipt(pg_temp.id('ticket'),
  (select version from public.tickets where id = pg_temp.id('ticket')), pg_temp.id('kafi'), gen_random_uuid(), null);
select ok((select receipt_snapshot::text not like '%Extra ice%' and receipt_snapshot::text not like '%Add a candle%' from public.print_attempts where id = pg_temp.id('attempt')),
  'item notes are not on the customer''s bill');
select public.record_print_outcome(pg_temp.id('attempt'), true, pg_temp.id('kafi'), null);
select throws_ok($$ update public.ticket_lines set notes = 'Changed' where id = pg_temp.line(pg_temp.id('ticket'), 'Horchata') $$,
  'ticket_finalized', 'a finalized ticket refuses even a direct change to a note');
select is(pg_temp.note(pg_temp.id('ticket'), 'Horchata'), 'Extra ice', '... and the note stays');

select * from finish();
rollback;
