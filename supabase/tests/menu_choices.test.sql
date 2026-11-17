-- Database tests: the Nov 16, 2026 menu. Beef or chicken choices, the soft drink and extras lists, Kids Plates.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.line(p_name text, p_quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.item(p_name), 'quantity', p_quantity) $$;
create function pg_temp.save(p_table text, p_lines jsonb)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order(p_table, pg_temp.id('waiter'), gen_random_uuid(), p_lines, null, 'America/Chicago', null) $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;
insert into ids select 'waiter', public.add_employee('770501', 'Choice Waiter', 'waiter', null);
select public.start_shift(null);

-- Beef or chicken --------------------------------------------------------------------------------------
select results_eq($$ select c.name from public.menu_items c where c.parent_item_id = pg_temp.item('Monterrey') order by c.sort_order $$,
  array['Monterrey (Beef)', 'Monterrey (Chicken)'], 'Monterrey asks: beef or chicken');
select is((select count(distinct parent_item_id)::int from public.menu_items where parent_item_id is not null), 13,
  'thirteen items ask: the eight of Nov 16, Taco salad fajita, and the four draft beers (Nov 17)');
select is((select count(*)::int from public.menu_items c join public.menu_items p on p.id = c.parent_item_id
            where (c.price_cents, c.tax_category_code, c.category_id, c.is_available)
                  is distinct from (p.price_cents, p.tax_category_code, p.category_id, p.is_available)), 0,
  'each choice has its item''s price, tax, page, and availability');

select throws_ok($$ select * from pg_temp.save('C1', jsonb_build_array(pg_temp.line('Monterrey'))) $$, 'P0001', 'choice_needed',
  'the item itself can''t be ordered without a choice');
select is((select count(*)::int from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where rt.code = 'C1' and t.status = 'open'), 0,
  '... and nothing is saved');
create temp table both_kinds as select * from pg_temp.save('C1', jsonb_build_array(pg_temp.line('Monterrey (Beef)', 2), pg_temp.line('Monterrey (Chicken)')));
select results_eq($$ select item_name, quantity::int, unit_price_cents from public.ticket_lines where batch_id = (select batch_id from both_kinds) order by line_no $$,
  $$ values ('Monterrey (Beef)'::text, 2, 1099), ('Monterrey (Chicken)', 1, 1099) $$, 'beef and chicken on one order, each named for the kitchen and the bill');
create temp table side_order as select * from pg_temp.save('C4', jsonb_build_array(pg_temp.line('Chimichanga (Side order) (Chicken)')));
select is((select item_name from public.ticket_lines where batch_id = (select batch_id from side_order)), 'Chimichanga (Side order) (Chicken)',
  'the side-order chimichanga says so, and which one');

-- A manager changes the item once; its choices follow.
select public.update_menu_item(pg_temp.item('Monterrey'), 1150, true, null);
select results_eq($$ select price_cents from public.menu_items where parent_item_id = pg_temp.item('Monterrey') $$, array[1150, 1150], 'a new price reaches both choices');
select public.update_menu_item(pg_temp.item('Monterrey'), 1150, false, null);
select throws_ok($$ select * from pg_temp.save('C2', jsonb_build_array(pg_temp.line('Monterrey (Beef)'))) $$, 'P0001', 'item_unavailable',
  'turning the item off turns its choices off');
select public.update_menu_item(pg_temp.item('Monterrey'), 1150, true, null);
select lives_ok($$ select * from pg_temp.save('C2', jsonb_build_array(pg_temp.line('Monterrey (Beef)'))) $$, '... and back on');

-- Names ---------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.menu_items i join public.menu_categories c on c.id = i.category_id
            where c.code = 'childs-plates' and i.name ~ '^Kids Plate #([1-9]|10)$'), 10, 'Kids Plate #1 to #10');
select is((select description from public.menu_items where name = 'Kids Plate #4'), 'Burrito and taco', 'what is on the plate is the description');
select ok(exists (select 1 from public.menu_items i join public.menu_categories c on c.id = i.category_id
                   where c.code = 'side-orders' and i.name = 'Chimichanga (Side order)')
          and exists (select 1 from public.menu_items i join public.menu_categories c on c.id = i.category_id
                   where c.code = 'favorites' and i.name = 'Chimichanga'), 'the side-order chimichanga says so; the main course keeps its name');

-- Lists ------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.menu_items i join public.menu_categories c on c.id = i.category_id
            where c.code = 'soft-drinks' and not i.is_retired and i.price_cents = 299), 10, 'ten soft drinks at $2.99');
select is((select count(*)::int from public.menu_items i join public.menu_categories c on c.id = i.category_id
            where c.code = 'extras' and not i.is_retired and i.price_cents = 150), 6, 'six extras at $1.50');
select is((select price_cents from public.menu_items where name = 'Mango (No Refills)'), 325, 'Mango (No Refills) is $3.25');
select results_eq($$ select is_retired, is_available from public.menu_items where name in ('Soft drink', 'Extras (each)') $$,
  $$ values (true, false), (true, false) $$, 'the old single items are retired, so old tickets still find them');
select throws_ok($$ select * from pg_temp.save('C3', jsonb_build_array(pg_temp.line('Soft drink'))) $$, 'P0001', 'item_unavailable', 'and can''t be ordered');
select throws_ok($$ update public.menu_items set is_available = true where name = 'Soft drink' $$, '23514', null, 'nor turned back on');

-- Security ------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.sync_menu_choices()', 'execute')
          and not has_function_privilege('authenticated', 'public.sync_menu_choices()', 'execute'), 'browsers can''t call the trigger function');

select * from finish();
rollback;
