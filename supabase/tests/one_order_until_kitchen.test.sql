-- Database tests: saving again adds to the order until its kitchen receipt is printed.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.line(p_name text, p_quantity integer, p_notes text default null) returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.item(p_name), 'quantity', p_quantity, 'notes', p_notes) $$;
create function pg_temp.save(p_lines jsonb, p_notes text default null, p_key uuid default gen_random_uuid(), p_at timestamptz default now())
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order('C5', pg_temp.id('waiter'), p_key, p_lines, p_notes, 'America/Chicago', null, p_at) $$;
create function pg_temp.ticket() returns bigint language sql as $$
  select t.id from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where rt.code = 'C5' and t.status = 'open' $$;
create function pg_temp.orders() returns bigint language sql as $$ select count(*) from public.ticket_batches where ticket_id = pg_temp.ticket() $$;
-- Since Nov 18, 2026 an item saved again is a line of its own, so these add up or list every line.
create function pg_temp.qty(p_name text, p_batch integer default 1) returns integer language sql as $$
  select sum(l.quantity)::integer from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id
   where b.ticket_id = pg_temp.ticket() and b.batch_no = p_batch and l.item_name = p_name $$;
create function pg_temp.notes(p_name text, p_batch integer) returns text[] language sql as $$
  select array_agg(coalesce(l.notes, '-') order by l.line_no) from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id
   where b.ticket_id = pg_temp.ticket() and b.batch_no = p_batch and l.item_name = p_name $$;
create function pg_temp.prices(p_name text, p_batch integer) returns integer[] language sql as $$
  select array_agg(l.unit_price_cents order by l.line_no) from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id
   where b.ticket_id = pg_temp.ticket() and b.batch_no = p_batch and l.item_name = p_name $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

insert into ids select 'waiter', public.add_employee('770401', 'One Order Waiter', 'waiter', null);
select public.start_shift(null);

-- Adding before the kitchen has it -------------------------------------------------------------------------
create temp table first_save as select * from pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 2)), 'Booth');
create temp table second_save as select * from pg_temp.save(jsonb_build_array(pg_temp.line('Horchata', 1), pg_temp.line('Taco', 1)), 'Birthday',
  '00000000-0000-4000-8000-0000000004a1');
select is((select batch_no from second_save), 1, 'saving again adds to the same order');
select is((select batch_id from second_save), (select batch_id from first_save), '... the same order, not a new one');
select is(pg_temp.orders(), 1::bigint, 'the ticket still has one order');
select is(pg_temp.qty('Taco'), 3, 'three tacos in all');
select is(pg_temp.qty('Horchata'), 1, 'a new item is added');
select is((select count(*)::int from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id where b.ticket_id = pg_temp.ticket()), 3,
  'three lines: an item saved again is a line of its own, for its own note (Nov 18, 2026)');
select is((select array_agg(item_name order by line_no) from public.ticket_lines where batch_id = (select batch_id from first_save)), array['Taco', 'Horchata', 'Taco'],
  'new lines go after the order''s own');
select is((select notes from public.ticket_batches where id = (select batch_id from first_save)), 'Booth / Birthday', 'the order note keeps both');
select is((select version from second_save), (select version from first_save) + 1, 'the ticket''s version moves on, so other screens refresh');

select is((select already_saved from pg_temp.save(jsonb_build_array(pg_temp.line('Horchata', 1), pg_temp.line('Taco', 1)), 'Birthday',
  '00000000-0000-4000-8000-0000000004a1')), true, 'pressing Save twice still saves once');
select is(pg_temp.qty('Taco'), 3, '... and adds nothing');

-- Same item, another note: still the same order, on a line of its own -----------------------------------------
select is((select batch_no from pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 1, 'No onions')))), 1, 'the same item with a note still goes on the same order');
select is(pg_temp.qty('Taco'), 4, '... as one more taco');
select is(pg_temp.notes('Taco', 1), array['-', '-', 'No onions'], '... on its own line with its note');
select pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 1, 'Extra salsa'), pg_temp.line('Taco', 1, 'No cheese')));
select is(pg_temp.notes('Taco', 1), array['-', '-', 'No onions', 'Extra salsa', 'No cheese'],
  'each taco keeps its own note, even two in one save');
select is(pg_temp.orders(), 1::bigint, 'still one order: nothing starts a new one before the kitchen receipt');

-- Printed for the kitchen -------------------------------------------------------------------------------
create temp table attempts as select * from public.request_kitchen_print(pg_temp.ticket(), null, pg_temp.id('waiter'), gen_random_uuid(), null);
select is((select batch_no from pg_temp.save(jsonb_build_array(pg_temp.line('Horchata', 1)))), 2, 'while the kitchen receipt waits for an answer, a save starts a new order');
select public.record_print_outcome(a.attempt_id, true, pg_temp.id('waiter'), null) from attempts a;
select is((select batch_no from pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 1)))), 2, 'the newest order, not yet sent, still takes more');
select pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 1)));
create temp table more_attempts as select * from public.request_kitchen_print(pg_temp.ticket(), null, pg_temp.id('waiter'), gen_random_uuid(), null);
select public.record_print_outcome(a.attempt_id, true, pg_temp.id('waiter'), null) from more_attempts a;
select is((select batch_no from pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 1)))), 3, 'once printed for the kitchen, the next save is a new order');

-- A kitchen receipt that didn't print: the kitchen hasn't got it, so it still takes more
create temp table failed as select * from public.request_kitchen_print(pg_temp.ticket(), null, pg_temp.id('waiter'), gen_random_uuid(), null);
select public.record_print_outcome(a.attempt_id, false, pg_temp.id('waiter'), null) from failed a;
select is((select batch_no from pg_temp.save(jsonb_build_array(pg_temp.line('Horchata', 1)))), 3, 'after "didn''t print", the order still takes more');

-- Prices -----------------------------------------------------------------------------------------------
create temp table taco_price as select (pg_temp.prices('Taco', 3))[1] as cents;
select public.update_menu_item(pg_temp.item('Taco'), 999, true, null);
select is((select batch_no from pg_temp.save(jsonb_build_array(pg_temp.line('Taco', 1)))), 3, 'after a menu price change, the item still joins the order');
select is(pg_temp.prices('Taco', 3), array[(select cents from taco_price), 999], '... as a new line at the new price; the saved line keeps its price');

-- What can't fit is refused, never split into a new order ---------------------------------------------------
select throws_ok($$ select * from pg_temp.save((select jsonb_agg(jsonb_build_object('name', 'Extra ' || g, 'price_cents', 100, 'tax_category', 'food', 'quantity', 1))
                                                 from generate_series(1, 99) g)) $$, 'P0001', 'order_full', 'more than 100 lines on one order is refused');
select is(pg_temp.orders(), 3::bigint, '... and starts no new order');

-- History ---------------------------------------------------------------------------------------------------
select ok((select (details ->> 'added_to_order')::boolean from public.audit_events where event_type = 'order_saved' and (details ->> 'batch')::bigint = (select batch_id from second_save)
            order by id desc limit 1), 'the history says it was added to an order');

select ok(not has_table_privilege('anon', 'public.order_save_keys', 'select') and not has_table_privilege('authenticated', 'public.order_save_keys', 'select'),
  'browsers can''t read the saved keys');
select is((select count(*)::int from public.order_save_keys where client_key = '00000000-0000-4000-8000-0000000004a1'), 1, 'the key of a save that added is kept');

select * from finish();
rollback;
