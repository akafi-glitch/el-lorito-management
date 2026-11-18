-- Database tests: an option can cost extra (Nov 18, 2026). Shrimp +$3.00 costs the item's price plus $3.00.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.price(p text) returns integer language sql as $$ select price_cents from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.save(p_table text, p_item text, p_at timestamptz default now())
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order(p_table, pg_temp.id('waiter'), gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item(p_item), 'quantity', 1)), null, 'America/Chicago', null, p_at) $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;
insert into ids select 'waiter', public.add_employee('770701', 'Extra Waiter', 'waiter', null);
select public.start_shift(null);

select is((select count(*)::int from public.menu_items where parent_item_id is not null and extra_cents <> 0), 0, 'every existing option starts at no extra charge');
select is((select count(*)::int from public.menu_items c join public.menu_items p on p.id = c.parent_item_id
            where not c.is_retired and c.price_cents <> p.price_cents + c.extra_cents), 0, 'every option costs its item''s price plus its extra');

-- Adding an option with an extra charge -----------------------------------------------------------------------
insert into ids select 'shrimp', public.add_menu_option(pg_temp.item('Beef or chicken fajitas'), 'Shrimp', null, 300);
select results_eq($$ select name, extra_cents, price_cents from public.menu_items where id = pg_temp.id('shrimp') $$,
  $$ values ('Beef or chicken fajitas (Shrimp)'::text, 300, 1699) $$, 'Shrimp +$3.00 on $13.99 fajitas costs $16.99');
select is((select (details ->> 'extra_cents')::int from public.audit_events where event_type = 'menu_option_added' order by id desc limit 1), 300,
  'the history has the extra charge');
create temp table shrimp_order as select * from pg_temp.save('A3', 'Beef or chicken fajitas (Shrimp)');
select is((select unit_price_cents from public.ticket_lines where batch_id = (select batch_id from shrimp_order)), 1699, 'the order is saved at $16.99');
select is((select total_cents from public.ticket_totals where ticket_id = (select ticket_id from shrimp_order)), 1699 + round(1699 * 0.085)::bigint,
  'the bill''s tax is on $16.99');
select is(pg_temp.price('Beef or chicken fajitas (Beef)'), 1399, 'the other options keep the item''s price');

-- The item's price moves; the extra stays on top -------------------------------------------------------------
select public.update_menu_item_details(pg_temp.item('Beef or chicken fajitas'), 'Beef or chicken fajitas', null, 1449, 'food', true, null);
select is(pg_temp.price('Beef or chicken fajitas (Shrimp)'), 1749, 'a new item price: Shrimp is $14.49 + $3.00');
select is(pg_temp.price('Beef or chicken fajitas (Chicken)'), 1449, '... and Chicken is $14.49');
select public.update_menu_item(pg_temp.item('Beef or chicken fajitas'), 1500, true, null);
select is(pg_temp.price('Beef or chicken fajitas (Shrimp)'), 1800, 'the same with the old price change');
select is((select unit_price_cents from public.ticket_lines where batch_id = (select batch_id from shrimp_order)), 1699, 'a saved order keeps its price');

-- Changing the extra -------------------------------------------------------------------------------------------
select is(public.set_menu_option_extra(pg_temp.id('shrimp'), 450, null), 'Beef or chicken fajitas (Shrimp)', 'the extra can change');
select results_eq($$ select extra_cents, price_cents from public.menu_items where id = pg_temp.id('shrimp') $$, $$ values (450, 1950) $$, '... to +$4.50: $19.50');
select public.set_menu_option_extra(pg_temp.id('shrimp'), 0, null);
select is(pg_temp.price('Beef or chicken fajitas (Shrimp)'), 1500, 'and to no extra charge');

-- Refusals ----------------------------------------------------------------------------------------------------
select throws_ok($$ select public.add_menu_option(pg_temp.item('Monterrey'), 'Steak', null, -1) $$, 'P0001', 'invalid_extra', 'a negative extra is refused');
select throws_ok($$ select public.set_menu_option_extra(pg_temp.id('shrimp'), 100001, null) $$, 'P0001', 'invalid_extra', 'more than $1,000 extra is refused');
select throws_ok($$ select public.set_menu_option_extra(pg_temp.item('Monterrey'), 100, null) $$, 'P0001', 'menu_item_not_found',
  'an item that isn''t an option has no extra');

select ok(not has_function_privilege('anon', 'public.set_menu_option_extra(bigint, integer, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.set_menu_option_extra(bigint, integer, uuid)', 'execute'), 'browsers can''t change it');

select * from finish();
rollback;
