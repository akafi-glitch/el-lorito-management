-- Database tests: the manager edits the menu (Nov 17, 2026). Adding, changing, options, and taking items off.
-- Also Taco salad fajita's choices and the beer list.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.category(p text) returns bigint language sql as $$ select id from public.menu_categories where code = p $$;
create function pg_temp.line(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.item(p_name), 'quantity', 1) $$;
create function pg_temp.save(p_table text, p_lines jsonb)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order(p_table, pg_temp.id('waiter'), gen_random_uuid(), p_lines, null, 'America/Chicago', null) $$;
create function pg_temp.options(p_item bigint) returns text[] language sql as $$
  select array_agg(c.choice_label order by c.sort_order) from public.menu_items c where c.parent_item_id = p_item and not c.is_retired $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;
insert into ids select 'waiter', public.add_employee('770601', 'Editor Waiter', 'waiter', null);
select public.start_shift(null);

-- Nov 17 menu ----------------------------------------------------------------------------------------------
select is(pg_temp.options(pg_temp.item('Taco salad fajita (beef or chicken)')), array['Beef', 'Chicken'], 'Taco salad fajita asks beef or chicken');
select results_eq($$ select name, price_cents from public.menu_items where name in ('Bud Light', 'Corona') order by name $$,
  $$ values ('Bud Light'::text, 499), ('Corona', 525) $$, 'each bottled beer is its own item: Bud Light $4.99, Corona $5.25');
select is(pg_temp.options(pg_temp.item('Draft beer - 12 oz')), array['Bud Light', 'Budweiser', 'Michelob Ultra', 'Coors Light', 'Miller Light'],
  'a draft asks which beer');
select results_eq($$ select is_retired from public.menu_items where name in ('Domestic beer', 'Import beer') $$,
  $$ values (true), (true) $$, 'the old Domestic and Import beer items are retired');
select is((select count(*)::int from public.menu_items where parent_item_id is not null and choice_label is null), 0, 'every option has its label');

-- Adding an item -------------------------------------------------------------------------------------------
insert into ids select 'birria', public.add_menu_item(pg_temp.category('favorites'), '  Birria tacos  ', ' Three tacos with consommé ', 1250, 'food', null);
select results_eq($$ select name, description, price_cents, tax_category_code, is_available, parent_item_id is null from public.menu_items where id = pg_temp.id('birria') $$,
  $$ values ('Birria tacos'::text, 'Three tacos with consommé'::text, 1250, 'food'::text, true, true) $$, 'a new item, trimmed and available');
select is((select sort_order from public.menu_items where id = pg_temp.id('birria')),
  (select max(sort_order) from public.menu_items where category_id = pg_temp.category('favorites') and sort_order < 100000), 'at the end of its page');
select is((select details ->> 'name' from public.audit_events where event_type = 'menu_item_added' order by id desc limit 1), 'Birria tacos', 'the history says who added what');
select lives_ok($$ select * from pg_temp.save('A1', jsonb_build_array(pg_temp.line('Birria tacos'))) $$, 'waiters can order it at once');
select throws_ok($$ select public.add_menu_item(pg_temp.category('favorites'), 'birria TACOS', null, 100, 'food', null) $$, 'P0001', 'name_taken',
  'the same name twice on a page is refused');
select throws_ok($$ select public.add_menu_item(pg_temp.category('favorites'), '   ', null, 100, 'food', null) $$, 'P0001', 'invalid_name', 'a blank name is refused');
select throws_ok($$ select public.add_menu_item(pg_temp.category('favorites'), 'X', null, 100, 'wine', null) $$, 'P0001', 'invalid_tax_category', 'an unknown tax type is refused');
select throws_ok($$ select public.add_menu_item(pg_temp.category('favorites'), 'X', null, -1, 'food', null) $$, '23514', null, 'a negative price is refused');
select throws_ok($$ select public.add_menu_item(999999, 'X', null, 100, 'food', null) $$, 'P0001', 'category_not_found', 'a page from nowhere is refused');

-- Options ----------------------------------------------------------------------------------------------------
select public.add_menu_option(pg_temp.id('birria'), 'Beef', null);
select public.add_menu_option(pg_temp.id('birria'), ' Goat ', null);
select is(pg_temp.options(pg_temp.id('birria')), array['Beef', 'Goat'], 'options in the order they were added');
select results_eq($$ select name, price_cents, tax_category_code from public.menu_items where parent_item_id = pg_temp.id('birria') order by sort_order $$,
  $$ values ('Birria tacos (Beef)'::text, 1250, 'food'::text), ('Birria tacos (Goat)', 1250, 'food') $$, 'each with the item''s price and tax');
select throws_ok($$ select * from pg_temp.save('A2', jsonb_build_array(pg_temp.line('Birria tacos'))) $$, 'P0001', 'choice_needed',
  'now waiters must choose');
select lives_ok($$ select * from pg_temp.save('A2', jsonb_build_array(pg_temp.line('Birria tacos (Goat)'))) $$, '... and can order a choice');
select throws_ok($$ select public.add_menu_option(pg_temp.id('birria'), 'goat', null) $$, 'P0001', 'option_taken', 'the same option twice is refused');
select throws_ok($$ select public.add_menu_option(pg_temp.id('birria'), '(Pork)', null) $$, 'P0001', 'invalid_option', 'brackets are refused');
select throws_ok($$ select public.add_menu_option(pg_temp.item('Birria tacos (Goat)'), 'Extra', null) $$, 'P0001', 'menu_item_not_found',
  'an option can''t have options');

-- Changing an item ---------------------------------------------------------------------------------------
select is(public.update_menu_item_details(pg_temp.id('birria'), 'Birria', 'With consommé', 1399, 'food', true, null), 'Birria', 'renamed and repriced');
select results_eq($$ select name, description, price_cents from public.menu_items where parent_item_id = pg_temp.id('birria') order by sort_order $$,
  $$ values ('Birria (Beef)'::text, 'With consommé'::text, 1399), ('Birria (Goat)', 'With consommé', 1399) $$, 'its options follow');
select is((select item_name from public.ticket_lines l join public.tickets t on t.id = l.ticket_id join public.restaurant_tables rt on rt.id = t.table_id
            where rt.code = 'A2' and t.status = 'open'), 'Birria tacos (Goat)', 'a ticket already made keeps its name');
select throws_ok($$ select public.update_menu_item_details(pg_temp.id('birria'), 'Monterrey', null, 100, 'food', true, null) $$, 'P0001', 'name_taken',
  'it can''t take another item''s name on its page');

-- Taking off the menu -----------------------------------------------------------------------------------------
select is(public.remove_menu_item(pg_temp.item('Birria (Goat)'), null), 'Birria (Goat)', 'one option comes off');
select is(pg_temp.options(pg_temp.id('birria')), array['Beef'], '... the other stays');
select public.remove_menu_item(pg_temp.id('birria'), null);
select is((select count(*)::int from public.menu_items where (id = pg_temp.id('birria') or parent_item_id = pg_temp.id('birria')) and not is_retired), 0,
  'taking the item off takes its options too');
select lives_ok($$ select public.add_menu_item(pg_temp.category('favorites'), 'Birria', null, 1399, 'food', null) $$, 'and its name can be used again');

-- Security ------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_menu_item(bigint, text, text, integer, text, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.update_menu_item_details(bigint, text, text, integer, text, boolean, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.add_menu_option(bigint, text, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.remove_menu_item(bigint, uuid)', 'execute'), 'browsers can''t edit the menu');

select * from finish();
rollback;
