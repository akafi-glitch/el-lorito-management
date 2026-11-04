-- Database tests: every menu item has a Spanish name, and nothing else about the menu or a bill changes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select is((select count(*) from public.menu_items where name_es is null), 0::bigint, 'every menu item has a Spanish name');
select is((select name_es from public.menu_items where name = 'Combo #5'), 'Combinación #5', 'a combination');
select is((select name_es from public.menu_items where name = 'Jarritos pineapple'), 'Jarritos de piña', 'accents and ñ are kept');
select is((select count(*) from public.menu_items where name = 'Poblano relleno' and name_es = 'Poblano relleno'), 2::bigint, 'an item on two pages has its name on both');
select ok(not exists (select 1 from public.menu_items where description is not null and description = name_es), 'descriptions are left alone');
select throws_ok($$ update public.menu_items set name_es = '  ' where name = 'Taco' $$, '23514', null, 'a blank name can''t be saved');
select ok(not has_column_privilege('anon', 'public.menu_items', 'name_es', 'select')
          and not has_column_privilege('authenticated', 'public.menu_items', 'name_es', 'select'), 'browsers can''t read it directly');

-- The customer's bill stays in English.
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;
select public.start_shift(null);
create temp table saved as
  select ticket_id from public.save_table_order('C1', public.add_employee('770201', 'Spanish Waiter', 'waiter', null), gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.menu_items where name = 'Combo #5' limit 1), 'quantity', 1)),
    null, 'America/Chicago', null);
select ok(public.customer_receipt_snapshot((select ticket_id from saved), now())::text not like '%Combinaci%', 'the customer''s bill has no Spanish');

select * from finish();
rollback;
