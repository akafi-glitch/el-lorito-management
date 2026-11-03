-- Database tests: finishing a shift closes the restaurant to new orders and deletes nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cd', 'finishmgr@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000cd', 'finishmgr', 'Finish Manager');

create temp table ids (name text primary key, id bigint);
create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000cd'::uuid $$;
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.save(p_table text, p_key uuid default gen_random_uuid())
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language sql as $$
  select * from public.save_table_order(p_table, pg_temp.id('kafi'), p_key,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.menu_items where name = 'Taco' order by id limit 1), 'quantity', 1)),
    null, 'America/Chicago', pg_temp.actor()) $$;
create function pg_temp.staff_version() returns bigint language sql as $$ select version from public.sync_versions where topic = 'staff' $$;
create function pg_temp.open_shifts() returns bigint language sql as $$ select count(*) from public.shifts where ended_at is null $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

insert into ids select 'kafi', public.add_employee('77001', 'Finish Waiter', 'waiter', pg_temp.actor());
select case when pg_temp.open_shifts() > 0 then public.finish_shift(pg_temp.actor()) end;

-- Closed: no orders ---------------------------------------------------------------------------------
create temp table before_closed as select (select count(*) from public.tickets) as tickets, (select count(*) from public.ticket_batches) as batches;
select throws_ok($$ select * from pg_temp.save('C1') $$, 'restaurant_closed', 'with no open shift, an order is refused');
select is((select count(*) from public.tickets), (select tickets from before_closed), '... and no ticket number is taken');
select is((select count(*) from public.ticket_batches), (select batches from before_closed), '... and no order is added');
select throws_ok($$ select public.finish_shift(pg_temp.actor()) $$, 'no_open_shift', 'there is no shift to finish');

-- During a shift ------------------------------------------------------------------------------------
insert into ids select 'shift', public.start_shift(pg_temp.actor());
select public.assign_duty('A', 'waiter', pg_temp.id('kafi'), pg_temp.actor());
insert into ids select 'unpaid', ticket_id from pg_temp.save('C1');
create temp table repeated (key uuid);
insert into repeated select gen_random_uuid();
insert into ids select 'printing', ticket_id from pg_temp.save('C2', (select key from repeated));
insert into ids select 'seated', public.seat_party(array['C3'], 2, pg_temp.actor());
select is((select shift_id from public.tickets where id = pg_temp.id('unpaid')), pg_temp.id('shift'), 'an order during the shift belongs to it');

-- Finishing -----------------------------------------------------------------------------------------
create temp table before_finish as select
  (select count(*) from public.tickets) as tickets,
  (select count(*) from public.ticket_batches) as batches,
  (select count(*) from public.shift_assignments) as assignments,
  (select count(*) from public.customer_visits) as visits,
  (select count(*) from public.audit_events) as audit,
  pg_temp.staff_version() as staff;

select is(public.finish_shift(pg_temp.actor()), pg_temp.id('shift'), 'finishing ends the open shift and returns it');
select is(pg_temp.open_shifts(), 0::bigint, '... so no shift is open');
select ok((select ended_at is not null and ended_by = pg_temp.actor() from public.shifts where id = pg_temp.id('shift')), '... and it records when and who');
select is((select count(*) from public.current_assignments), 0::bigint, 'nobody is assigned any more');
select is((select count(*) from public.shift_assignments), (select assignments from before_finish), 'assignments are ended, not deleted');
select ok(pg_temp.staff_version() > (select staff from before_finish), 'every screen hears about it');
select is((select details ->> 'shift' from public.audit_events where event_type = 'shift_finished' order by id desc limit 1), pg_temp.id('shift')::text, 'the history records it');
select is((select count(*) from public.audit_events), (select audit from before_finish) + 1, 'history only grows');

select is((select count(*) from public.tickets), (select tickets from before_finish), 'no tickets deleted');
select is((select count(*) from public.ticket_batches), (select batches from before_finish), 'no orders deleted');
select is((select count(*) from public.customer_visits), (select visits from before_finish), 'no visits deleted');
select is((select status::text from public.tickets where id = pg_temp.id('unpaid')), 'open', 'an unpaid ticket stays open');
select ok((select cleared_at is null from public.customer_visits where id = pg_temp.id('seated')), 'a seated table stays seated');

-- After finishing -----------------------------------------------------------------------------------
select throws_ok($$ select * from pg_temp.save('C1') $$, 'restaurant_closed', 'a new order on an open ticket is refused');
select is((select already_saved from pg_temp.save('C2', (select key from repeated))), true, 'a repeated press of a saved order still gets its answer');
select throws_ok($$ select public.assign_duty('A', 'waiter', pg_temp.id('kafi'), pg_temp.actor()) $$, 'no_open_shift', 'staff can''t be assigned');
select throws_ok($$ select public.finish_shift(pg_temp.actor()) $$, 'no_open_shift', 'a second device can''t finish it twice');

-- A customer receipt already on its way can finish while closed.
insert into ids select 'attempt', attempt_id from public.request_customer_receipt(pg_temp.id('printing'),
  (select version from public.tickets where id = pg_temp.id('printing')), pg_temp.id('kafi'), gen_random_uuid(), pg_temp.actor());
select public.record_print_outcome(pg_temp.id('attempt'), true, pg_temp.id('kafi'), pg_temp.actor());
select is((select status::text from public.tickets where id = pg_temp.id('printing')), 'finalized', 'a customer receipt can still finish a ticket');

-- Open again ----------------------------------------------------------------------------------------
insert into ids select 'next', public.start_shift(pg_temp.actor());
select is((select ticket_id from pg_temp.save('C1')), pg_temp.id('unpaid'), 'in the next shift, the waiter picks the open ticket up');
select is((select shift_id from public.tickets where id = pg_temp.id('unpaid')), pg_temp.id('shift'), '... and it stays in the shift it started in');

-- Security ------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.finish_shift(uuid)', 'execute'), 'signed-out browsers can''t finish a shift');
select ok(not has_function_privilege('authenticated', 'public.finish_shift(uuid)', 'execute'), 'signed-in browsers can''t call it directly either');

select * from finish();
rollback;
