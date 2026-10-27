-- Database tests for tax and ticket totals (Phase 8). The same examples are in src/features/billing/tax.test.ts.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- Rounding ----------------------------------------------------------------------------------
select is(public.tax_cents(750, 850), 64::bigint, '$7.50 food: $0.6375 rounds to $0.64');
select is(public.tax_cents(525, 1050), 55::bigint, '$5.25 liquor: $0.55125 rounds to $0.55');
select is(public.tax_cents(100, 850), 9::bigint, 'exactly half a cent rounds up: $1.00 food -> $0.085 -> $0.09');
select is(public.tax_cents(100, 1050), 11::bigint, 'exactly half a cent rounds up: $1.00 liquor -> $0.105 -> $0.11');
select is(public.tax_cents(1, 850), 0::bigint, '1 cent of food has no tax ($0.00085)');
select is(public.tax_cents(0, 850), 0::bigint, 'nothing costs nothing');
select is(public.tax_cents(2379, 850), 202::bigint, '$23.79 food: $2.02215 -> $2.02');
select is(public.tax_cents(-1, 850), null, 'negative amounts are refused (null)');
select is(public.tax_cents(1089000000, 1050), 114345000::bigint, 'large amounts stay exact');

-- Totals of real tickets ------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'tot@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000ee', 'tot', 'Totals');
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000ee'::uuid $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create temp table ids (name text primary key, id bigint);
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
insert into ids select 'visit', public.seat_party(array['A1'], 2, pg_temp.actor());
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.save(p_lines jsonb) returns bigint language sql as $$
  select ticket_id from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'), p_lines, 'America/Chicago', pg_temp.actor(),
                                           '2026-10-27 12:00 America/Chicago') $$;

-- 2 x Combo #5 ($9.40) + 1 domestic beer ($4.99) + 1 margarita ($6.99)
insert into ids select 'mixed', pg_temp.save(jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.item('Combo #5'), 'quantity', 2),
  jsonb_build_object('item_id', pg_temp.item('Domestic beer'), 'quantity', 1),
  jsonb_build_object('item_id', pg_temp.item('Lime margarita (large)'), 'quantity', 1),
  jsonb_build_object('item_id', pg_temp.item('Horchata'), 'quantity', 1)));

select results_eq($$ select food_subtotal_cents, liquor_subtotal_cents from public.ticket_totals where ticket_id = pg_temp.id('mixed') $$,
  $$ values (2205::bigint, 1198::bigint) $$, 'food $18.80 + horchata $3.25 = $22.05; beer $4.99 + margarita $6.99 = $11.98');
select results_eq($$ select food_tax_cents, liquor_tax_cents, total_cents from public.ticket_totals where ticket_id = pg_temp.id('mixed') $$,
  $$ values (187::bigint, 126::bigint, 3716::bigint) $$, 'food tax $1.87 ($1.874), liquor tax $1.26 ($1.2579), total $37.16');
select results_eq($$ select food_rate_bp, liquor_rate_bp from public.ticket_totals where ticket_id = pg_temp.id('mixed') $$,
  $$ values (850, 1050) $$, 'the rates come from the tax groups: 8.5% and 10.5%');

insert into ids select 'food_only', pg_temp.save(jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 3)));
select results_eq($$ select food_subtotal_cents, liquor_subtotal_cents, food_tax_cents, liquor_tax_cents, total_cents
                    from public.ticket_totals where ticket_id = pg_temp.id('food_only') $$,
  $$ values (705::bigint, 0::bigint, 60::bigint, 0::bigint, 765::bigint) $$, 'a food-only ticket has no liquor tax: 3 tacos = $7.65');

insert into ids select 'liquor_only', pg_temp.save(jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Draft beer - 32 oz'), 'quantity', 2)));
select results_eq($$ select food_tax_cents, liquor_tax_cents, total_cents from public.ticket_totals where ticket_id = pg_temp.id('liquor_only') $$,
  $$ values (0::bigint, 121::bigint, 1271::bigint) $$, 'two 32 oz drafts: $11.50 + $1.21 ($1.2075) = $12.71');

select is((select total_cents from public.ticket_totals where ticket_id = pg_temp.id('mixed')),
  (select food_subtotal_cents + liquor_subtotal_cents + food_tax_cents + liquor_tax_cents from public.ticket_totals where ticket_id = pg_temp.id('mixed')),
  'total = food subtotal + liquor subtotal + food tax + liquor tax');

-- A lunch item after 3 PM is taxed on its higher price.
insert into ids select 'late', (select ticket_id from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Lunch #2'), 'quantity', 1)), 'America/Chicago', pg_temp.actor(),
  '2026-10-27 15:30 America/Chicago'));
select results_eq($$ select food_subtotal_cents, food_tax_cents, total_cents from public.ticket_totals where ticket_id = pg_temp.id('late') $$,
  $$ values (899::bigint, 76::bigint, 975::bigint) $$, 'Lunch #2 after 3 PM: $8.99 + $0.76 ($0.76415) = $9.75');

-- Browsers ------------------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.ticket_totals', 'select')
          and not has_table_privilege('authenticated', 'public.ticket_totals', 'select')
          and has_table_privilege('service_role', 'public.ticket_totals', 'select'),
  'browsers can''t read ticket totals; the server role can');
select throws_ok($$ insert into public.tax_groups (code, name, rate_bp, sort_order) values ('wine', 'Wine', 1000, 9) $$,
  '23514', null, 'only the food and liquor tax groups exist');

select * from finish();
rollback;
