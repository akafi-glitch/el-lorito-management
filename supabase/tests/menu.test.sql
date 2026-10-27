-- Database tests for the menu and tax categories (Phase 6).
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cc', 'menu@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000cc', 'menu', 'Menu admin');
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000cc'::uuid $$;
create function pg_temp.price(p text) returns integer language sql as $$
  select price_cents from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.item_id(p text) returns bigint language sql as $$
  select id from public.menu_items where name = p order by id limit 1 $$;

-- Structure ---------------------------------------------------------------------------------
select has_table('public', 'tax_groups', 'tax_groups exists');
select has_table('public', 'tax_categories', 'tax_categories exists');
select has_table('public', 'menu_categories', 'menu_categories exists');
select has_table('public', 'menu_items', 'menu_items exists');

-- Tax ---------------------------------------------------------------------------------------
select results_eq($$ select code, rate_bp from public.tax_groups order by sort_order $$,
  $$ values ('food'::text, 850), ('liquor'::text, 1050) $$, 'food 8.5%, liquor 10.5%');
select results_eq($$ select code, tax_group_code from public.tax_categories order by sort_order $$,
  $$ values ('food'::text, 'food'::text), ('nonalcoholic', 'food'), ('beer', 'liquor'), ('cocktail', 'liquor') $$,
  'food and nonalcoholic drinks are taxed as food; beer and cocktails as liquor');

-- The owner's menu ----------------------------------------------------------------------------
select is((select count(*)::int from public.menu_categories), 26, '26 categories');
select is((select count(*)::int from public.menu_items i join public.menu_categories c on c.id = i.category_id
           where c.code <> 'cheese-dip-add-ons'), 206, 'all 206 items from the menu file');
select results_eq($$ select price_cents from public.menu_items i join public.menu_categories c on c.id = i.category_id
                    where c.code = 'cheese-dip-add-ons' order by i.sort_order $$,
  array[125, 150, 100, 125], 'cheese dip add-ons at the menu''s prices');
select is(pg_temp.price('Chile con queso'), 519, 'chile con queso is $5.19');
select is(pg_temp.price('Lunch #1'), 825, 'Lunch #1 is $8.25');
select is(pg_temp.price('Molcajete'), 2499, 'Molcajete is $24.99');
select is(pg_temp.price('Draft beer - 32 oz'), 575, 'Draft beer 32 oz is $5.75');
select is((select count(*)::int from public.menu_items where price_cents <= 0), 0, 'every item has a price');
select is((select count(*)::int from public.menu_items where not is_available), 0, 'every item starts available');

select results_eq($$ select late_from, late_surcharge_cents from public.menu_categories where late_from is not null $$,
  $$ values ('15:00'::time, 100) $$, 'only one category has late pricing: from 3:00 PM, $1.00 more');
select is((select c.code from public.menu_categories c where c.late_from is not null), 'lunch', 'the late-priced category is Lunch');
select is((select count(*)::int from public.menu_items i join public.menu_categories c on c.id = i.category_id where c.code = 'lunch'),
  14, '14 lunch items');

select results_eq($$ select i.tax_category_code, count(*)::int from public.menu_items i group by 1 order by 1 $$,
  $$ values ('beer'::text, 7), ('cocktail', 22), ('food', 160), ('nonalcoholic', 21) $$,
  'tax categories: 7 beers, 22 cocktails, 21 nonalcoholic drinks, the rest food');

-- Rules ---------------------------------------------------------------------------------------
select throws_ok($$ insert into public.menu_categories (code, name, sort_order, late_from) values ('x', 'X', 99, '15:00') $$,
  '23514', null, 'late time without an amount is refused');
select throws_ok($$ update public.menu_items set price_cents = -1 where name = 'Taco' $$,
  '23514', null, 'negative prices are refused');
select throws_ok($$ insert into public.menu_items (category_id, name, price_cents, tax_category_code, sort_order)
                   select category_id, name, 100, 'food', 999 from public.menu_items where name = 'Taco' $$,
  '23505', null, 'the same name twice in one category is refused');

-- update_menu_item ------------------------------------------------------------------------------
select is(public.update_menu_item(pg_temp.item_id('Taco'), 250, false, pg_temp.actor()), 'Taco', 'price and availability change; the name comes back');
select results_eq($$ select price_cents, is_available from public.menu_items where name = 'Taco' $$,
  $$ values (250, false) $$, 'taco now $2.50 and turned off');
select is((select count(*)::int from public.audit_events where event_type = 'menu_item_changed'
             and details -> 'price_cents' = '{"from": 235, "to": 250}'::jsonb), 1, 'the change is in the audit history');
select throws_ok($$ select public.update_menu_item(-5, 100, true, pg_temp.actor()) $$,
  'P0001', 'menu_item_not_found', 'unknown items are refused');

-- Browsers ------------------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.menu_items', 'select')
          and not has_table_privilege('authenticated', 'public.menu_items', 'select')
          and not has_function_privilege('authenticated', 'public.update_menu_item(bigint, integer, boolean, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.update_menu_item(bigint, integer, boolean, uuid)', 'execute'),
  'browsers can''t read the menu tables or change items; the server role can');

select * from finish();
rollback;
