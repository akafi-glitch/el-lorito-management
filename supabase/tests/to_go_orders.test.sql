-- Database tests: to-go orders take a free spot, stay apart from the Floor, and otherwise work like any table.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.lines() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', (select id from public.menu_items where name = 'Taco' order by id limit 1), 'quantity', 1)) $$;
create function pg_temp.to_go(p_key uuid default gen_random_uuid())
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean, table_code text)
language sql as $$ select * from public.save_to_go_order(pg_temp.id('waiter'), p_key, pg_temp.lines(), null, 'America/Chicago', null) $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

insert into ids select 'waiter', public.add_employee('770301', 'To-Go Waiter', 'waiter', null);

-- The spots ---------------------------------------------------------------------------------------------
select is((select count(*)::int from public.restaurant_tables where section_code = 'TOGO'), 30, '30 to-go spots');
select is((select label from public.restaurant_tables where code = 'TOGO-1'), 'To-Go 1', 'named for the receipts');
select ok((select rotation_order is null from public.sections where code = 'TOGO'), 'not in the seating rotation');
select ok(not ('TOGO' = any (select section_code from public.current_rotation() )), 'nor in the current rotation');
select is((select count(*)::int from public.restaurant_tables where section_code <> 'TOGO'), 45, 'the Floor keeps its 45 tables');

-- Closed ------------------------------------------------------------------------------------------------
select case when (select count(*) from public.shifts where ended_at is null) > 0 then public.finish_shift(null) end;
select throws_ok($$ select * from pg_temp.to_go() $$, 'restaurant_closed', 'no to-go orders while the restaurant is closed');
select public.start_shift(null);

-- Taking spots ------------------------------------------------------------------------------------------
create temp table first_order as select * from pg_temp.to_go('00000000-0000-4000-8000-000000000001');
select is((select table_code from first_order), 'TOGO-1', 'the first order takes the first spot');
create temp table second_order as select * from pg_temp.to_go();
select is((select table_code from second_order), 'TOGO-2', 'the next customer gets the next spot, with their own ticket');
select isnt((select ticket_id from first_order), (select ticket_id from second_order), '... two tickets');
select is((select shift_id from public.tickets where id = (select ticket_id from first_order)),
  (select id from public.shifts where ended_at is null), 'it belongs to the open shift');
select is((select visit_id from public.tickets where id = (select ticket_id from first_order)), null, 'nobody is seated');

select is((select already_saved from pg_temp.to_go('00000000-0000-4000-8000-000000000001')), true, 'pressing Save twice saves once');
select is((select table_code from pg_temp.to_go('00000000-0000-4000-8000-000000000001')), 'TOGO-1', '... and answers with the same spot');
select is((select count(*)::int from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id
             where rt.section_code = 'TOGO' and t.status = 'open'), 2, 'still two orders');

-- It works like any table ---------------------------------------------------------------------------------
select is((select ticket_id from public.save_table_order('TOGO-1', pg_temp.id('waiter'), gen_random_uuid(), pg_temp.lines(), null, 'America/Chicago', null)),
  (select ticket_id from first_order), 'more for that customer goes on their ticket');
select is(public.ticket_table_labels((select ticket_id from first_order)), 'To-Go 1', 'receipts and the history name the spot');
create temp table attempt as select * from public.request_customer_receipt((select ticket_id from first_order),
  (select version from public.tickets where id = (select ticket_id from first_order)), pg_temp.id('waiter'), gen_random_uuid(), null);
select public.record_print_outcome((select attempt_id from attempt), true, pg_temp.id('waiter'), null);
select is((select status::text from public.tickets where id = (select ticket_id from first_order)), 'finalized', 'the customer receipt finishes it');
select is((select table_code from pg_temp.to_go()), 'TOGO-1', 'and the spot is free again');

-- Full ----------------------------------------------------------------------------------------------------
select count(*) from (select (pg_temp.to_go()).ticket_id from generate_series(1, 27)) filled;
select is((select count(*)::int from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id
             where rt.section_code = 'TOGO' and t.status = 'open'), 29, '29 taken');
select lives_ok($$ select * from pg_temp.to_go() $$, 'the last spot can be used');
select throws_ok($$ select * from pg_temp.to_go() $$, 'to_go_full', 'when all 30 are taken, it says so');

select ok(not has_function_privilege('anon', 'public.save_to_go_order(bigint, uuid, jsonb, text, text, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.save_to_go_order(bigint, uuid, jsonb, text, text, uuid)', 'execute'), 'browsers can''t call it');

select * from finish();
rollback;
