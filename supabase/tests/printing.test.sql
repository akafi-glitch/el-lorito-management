-- Database tests for printing tickets (Phase 9).
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

alter sequence public.ticket_number_seq restart with 1001;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff', 'pr@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000ff', 'printer', 'Printer test');
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000ff'::uuid $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create temp table ids (name text primary key, id bigint);
insert into ids select 'kafi', public.add_employee('01', 'Kafi', 'waiter', pg_temp.actor());
insert into ids select 'musfika', public.add_employee('02', 'Musfika', 'waiter', pg_temp.actor());
insert into ids select 'visit', public.seat_party(array['C2'], 3, pg_temp.actor());
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.ticket(p bigint) returns public.tickets language sql as $$ select * from public.tickets where ticket_number = p $$;

-- Ticket 1001: 2 x Combo #5 + domestic beer = food $18.80, liquor $4.99 -> taxes $1.60 + $0.52 -> $25.91
insert into ids select 't1', ticket_id from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Combo #5'), 'quantity', 2),
                    jsonb_build_object('item_id', pg_temp.item('Domestic beer'), 'quantity', 1)),
  'America/Chicago', pg_temp.actor());

select has_table('public', 'print_attempts', 'print_attempts exists');

-- Refusals before printing ------------------------------------------------------------------------
select throws_ok($$ select public.print_ticket(pg_temp.id('visit'), pg_temp.id('t1'), 99, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'stale_ticket', 'printing an older version is refused (save first)');
select throws_ok($$ select public.reprint_ticket(pg_temp.id('t1'), pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_not_printed', 'a ticket that was never printed can''t be reprinted');
select throws_ok($$ update public.tickets set status = 'printed', printed_at = now() where id = pg_temp.id('t1') $$,
  '23514', null, 'a ticket can''t be marked printed without its frozen totals');

-- First print ---------------------------------------------------------------------------------------
insert into ids select 'a1', public.print_ticket(pg_temp.id('visit'), pg_temp.id('t1'), 1, pg_temp.id('musfika'), pg_temp.actor());
select results_eq($$ select status::text, printed_at is not null, printed_by_employee_id, version from public.tickets where id = pg_temp.id('t1') $$,
  $$ select 'printed'::text, true, pg_temp.id('musfika'), 2 $$, 'printing locks the ticket, records when and who, raises the version');
select results_eq($$ select food_subtotal_cents, liquor_subtotal_cents, food_rate_bp, liquor_rate_bp, food_tax_cents, liquor_tax_cents, total_cents
                    from public.tickets where id = pg_temp.id('t1') $$,
  $$ values (1880::bigint, 499::bigint, 850, 1050, 160::bigint, 52::bigint, 2591::bigint) $$,
  'the totals are frozen on the ticket: $18.80 + $4.99 + $1.60 + $0.52 = $25.91');
select results_eq($$ select attempt_no, kind::text, employee_id, outcome::text from public.print_attempts where id = pg_temp.id('a1') $$,
  $$ select 1, 'first'::text, pg_temp.id('musfika'), 'unknown'::text $$, 'attempt 1 is recorded; nobody has said it printed yet');
select is((select employee_id from public.tickets where id = pg_temp.id('t1')), pg_temp.id('kafi'), 'the ticket still belongs to the waiter who made it');
select is((select cleared_at from public.customer_visits where id = pg_temp.id('visit')), null, 'printing never clears the table');

-- Locked for good ---------------------------------------------------------------------------------------
select throws_ok($$ select public.print_ticket(pg_temp.id('visit'), pg_temp.id('t1'), 2, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_printed', 'the first print can''t happen twice (reprint instead)');
select throws_ok($$ select * from public.save_ticket(pg_temp.id('visit'), pg_temp.id('t1'), 2, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1)), 'America/Chicago', pg_temp.actor()) $$,
  'P0001', 'ticket_printed', 'a printed ticket can''t be changed');
select throws_ok($$ select public.cancel_ticket(pg_temp.id('visit'), pg_temp.id('t1'), 2, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_printed', 'a printed ticket can''t be cancelled');

-- Tax-rate and price changes don't touch a printed ticket -----------------------------------------------
update public.tax_groups set rate_bp = 900 where code = 'food';
select is((select total_cents from public.ticket_totals where ticket_id = pg_temp.id('t1')), 2591::bigint,
  'a later tax-rate change leaves the printed total at $25.91');
select is((select food_rate_bp from public.ticket_totals where ticket_id = pg_temp.id('t1')), 850, 'and its food rate at 8.5%');
insert into ids select 't2', ticket_id from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Taco'), 'quantity', 1)), 'America/Chicago', pg_temp.actor());
select is((select food_tax_cents from public.ticket_totals where ticket_id = pg_temp.id('t2')), 21::bigint,
  'an unprinted ticket uses the current rate ($2.35 at 9% = $0.2115 -> $0.21)');
update public.tax_groups set rate_bp = 850 where code = 'food';

-- The waiter's answer -----------------------------------------------------------------------------------
select lives_ok($$ select public.record_print_outcome(pg_temp.id('a1'), false, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'the waiter says it didn''t print');
select results_eq($$ select outcome::text, outcome_by_employee_id, outcome_at is not null from public.print_attempts where id = pg_temp.id('a1') $$,
  $$ select 'not_printed'::text, pg_temp.id('kafi'), true $$, 'that answer is stored with who said it and when');
select throws_ok($$ select public.record_print_outcome(pg_temp.id('a1'), true, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'outcome_already_recorded', 'an attempt''s answer can''t be changed afterwards');
select throws_ok($$ select public.record_print_outcome(999999, true, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'print_attempt_not_found', 'unknown attempts are refused');

-- Reprints ------------------------------------------------------------------------------------------------
insert into ids select 'a2', public.reprint_ticket(pg_temp.id('t1'), pg_temp.id('kafi'), pg_temp.actor());
insert into ids select 'a3', public.reprint_ticket(pg_temp.id('t1'), pg_temp.id('musfika'), pg_temp.actor());
select results_eq($$ select attempt_no, kind::text from public.print_attempts where ticket_id = pg_temp.id('t1') order by attempt_no $$,
  $$ values (1, 'first'::text), (2, 'reprint'), (3, 'reprint') $$, 'reprints count up: 1 first, then 2 and 3');
select lives_ok($$ select public.record_print_outcome(pg_temp.id('a3'), true, pg_temp.id('musfika'), pg_temp.actor()) $$,
  'the waiter says the third one printed');
select throws_ok($$ select public.record_print_outcome(pg_temp.id('a2'), null, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'invalid_outcome', 'an answer is never blank');
select is((select outcome::text from public.print_attempts where id = pg_temp.id('a2')), 'unknown',
  'an attempt nobody answered stays unknown (never assumed printed)');
select is((select version from public.tickets where id = pg_temp.id('t1')), 2, 'reprinting doesn''t change the ticket');
select is((select total_cents from public.tickets where id = pg_temp.id('t1')), 2591::bigint, 'a reprint shows the same frozen total');

-- Empty, cancelled, closed -------------------------------------------------------------------------------
select public.cancel_ticket(pg_temp.id('visit'), pg_temp.id('t2'), 1, pg_temp.id('kafi'), pg_temp.actor());
select throws_ok($$ select public.print_ticket(pg_temp.id('visit'), pg_temp.id('t2'), 2, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_cancelled', 'a cancelled ticket can''t be printed');
select throws_ok($$ select public.reprint_ticket(pg_temp.id('t2'), pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'ticket_not_printed', 'or reprinted');

insert into ids select 't3', ticket_id from public.save_ticket(pg_temp.id('visit'), null, null, pg_temp.id('kafi'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Horchata'), 'quantity', 1)), 'America/Chicago', pg_temp.actor());
select public.clear_visit(pg_temp.id('visit'),
  public.mark_chips_served(pg_temp.id('visit'), (select version from public.customer_visits where id = pg_temp.id('visit')), pg_temp.actor()),
  pg_temp.actor());
select throws_ok($$ select public.print_ticket(pg_temp.id('visit'), pg_temp.id('t3'), 1, pg_temp.id('kafi'), pg_temp.actor()) $$,
  'P0001', 'visit_closed', 'after the table is cleared, an unprinted ticket can''t be printed for the first time');
select lives_ok($$ select public.reprint_ticket(pg_temp.id('t1'), pg_temp.id('kafi'), pg_temp.actor()) $$,
  'a printed ticket can still be reprinted after the table is cleared');

select public.update_employee(pg_temp.id('musfika'), 'Musfika', 'waiter', false, pg_temp.actor());
select throws_ok($$ select public.reprint_ticket(pg_temp.id('t1'), pg_temp.id('musfika'), pg_temp.actor()) $$,
  'P0001', 'employee_inactive', 'a turned-off employee can''t print');

-- History ---------------------------------------------------------------------------------------------------
select results_eq($$ select event_type, count(*)::int from public.audit_events
                    where event_type in ('ticket_printed', 'ticket_reprinted', 'print_outcome') group by 1 order by 1 $$,
  $$ values ('print_outcome'::text, 2), ('ticket_printed', 1), ('ticket_reprinted', 3) $$, 'every print, reprint, and answer is recorded');

-- Browsers ----------------------------------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.print_attempts', 'select')
          and not has_table_privilege('authenticated', 'public.print_attempts', 'select')
          and not has_table_privilege('authenticated', 'public.ticket_totals', 'select'),
  'browsers can''t read print attempts or totals');
select ok(not has_function_privilege('authenticated', 'public.print_ticket(bigint, bigint, integer, bigint, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.reprint_ticket(bigint, bigint, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.record_print_outcome(bigint, boolean, bigint, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.print_ticket(bigint, bigint, integer, bigint, uuid)', 'execute'),
  'browsers can''t print; the server role can');

select * from finish();
rollback;
