-- Database tests: taking food off an order the kitchen already has needs a manager. Adding never does.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

create temp table ids (name text primary key, id bigint);
create function pg_temp.id(p text) returns bigint language sql as $$ select id from ids where name = p $$;
create function pg_temp.item(p text) returns bigint language sql as $$ select id from public.menu_items where name = p order by id limit 1 $$;
create function pg_temp.save(p_table text, p_name text, p_quantity integer) returns bigint language sql as $$
  select ticket_id from public.save_table_order(p_table, pg_temp.id('waiter'), gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item(p_name), 'quantity', p_quantity)), null, 'America/Chicago', null) $$;
create function pg_temp.version(p_ticket bigint) returns integer language sql as $$ select version from public.tickets where id = p_ticket $$;
create function pg_temp.line(p_ticket bigint, p_name text) returns bigint language sql as $$
  select id from public.ticket_lines where ticket_id = p_ticket and item_name = p_name order by id desc limit 1 $$;
create function pg_temp.quantity(p_line bigint) returns integer language sql as $$ select quantity::integer from public.ticket_lines where id = p_line $$;
create function pg_temp.change(p_ticket bigint, p_change jsonb, p_approved bigint default null) returns integer language sql as $$
  select public.change_ticket(p_ticket, pg_temp.version(p_ticket), pg_temp.id('waiter'), jsonb_build_array(p_change), null, p_approved) $$;
create function pg_temp.print_kitchen(p_ticket bigint) returns void language plpgsql as $$
declare
  v_attempt bigint;
begin
  for v_attempt in select attempt_id from public.request_kitchen_print(p_ticket, null, pg_temp.id('waiter'), gen_random_uuid(), null) loop
    perform public.record_print_outcome(v_attempt, true, pg_temp.id('waiter'), null);
  end loop;
end;
$$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

insert into ids select 'waiter', public.add_employee('770101', 'Approve Waiter', 'waiter', null);
insert into ids select 'boss', public.add_employee('770102', 'Approve Boss', 'manager', null);
insert into ids select 'nopin', public.add_employee('770103', 'No Pin Boss', 'manager', null);
select public.set_manager_pin('770102', '$2b$04$' || repeat('a', 53), null);
select public.start_shift(null);

-- Before the kitchen has it: the waiter decides --------------------------------------------------------
insert into ids select 'free', pg_temp.save('C1', 'Taco', 3);
select lives_ok($$ select pg_temp.change(pg_temp.id('free'), jsonb_build_object('op', 'quantity', 'line_id', pg_temp.line(pg_temp.id('free'), 'Taco'), 'quantity', 2)) $$,
  'before printing, a waiter can lower a quantity');
select lives_ok($$ select pg_temp.change(pg_temp.id('free'), jsonb_build_object('op', 'remove', 'line_id', pg_temp.line(pg_temp.id('free'), 'Taco'))) $$,
  '... and remove an item');
select lives_ok($$ select public.cancel_order(pg_temp.id('free'), pg_temp.version(pg_temp.id('free')), pg_temp.id('waiter'), null) $$,
  '... and cancel the ticket');

-- After the kitchen has it ----------------------------------------------------------------------------
insert into ids select 'ticket', pg_temp.save('C2', 'Taco', 3);
select pg_temp.print_kitchen(pg_temp.id('ticket'));
insert into ids select 'taco', pg_temp.line(pg_temp.id('ticket'), 'Taco');

select throws_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'remove', 'line_id', pg_temp.id('taco'))) $$,
  'manager_approval_required', 'after printing, removing an item needs a manager');
select throws_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'quantity', 'line_id', pg_temp.id('taco'), 'quantity', 2)) $$,
  'manager_approval_required', '... and so does lowering a quantity');
select throws_ok($$ select public.cancel_order(pg_temp.id('ticket'), pg_temp.version(pg_temp.id('ticket')), pg_temp.id('waiter'), null) $$,
  'manager_approval_required', '... and cancelling the ticket');
select is(pg_temp.quantity(pg_temp.id('taco')), 3, 'nothing changed');
select is((select status::text from public.tickets where id = pg_temp.id('ticket')), 'open', 'the ticket is still open');

select lives_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'line_notes', 'line_id', pg_temp.id('taco'), 'notes', 'No onions')) $$,
  'a note needs no manager');
select lives_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'quantity', 'line_id', pg_temp.id('taco'), 'quantity', 4)) $$,
  'nor does raising a quantity');
select pg_temp.save('C2', 'Horchata', 1);
select is((select count(*) from public.ticket_batches where ticket_id = pg_temp.id('ticket')), 2::bigint, 'a waiter adds more as a new order, on the same ticket');
select lives_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'remove', 'line_id', pg_temp.line(pg_temp.id('ticket'), 'Horchata'))) $$,
  'an order the kitchen hasn''t got can still be changed, on the same ticket');

-- Who can approve --------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'remove', 'line_id', pg_temp.id('taco')), pg_temp.id('waiter')) $$,
  'pin_not_allowed', 'a waiter can''t approve');
select throws_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'remove', 'line_id', pg_temp.id('taco')), pg_temp.id('nopin')) $$,
  'pin_not_allowed', 'nor a manager with no PIN');
select throws_ok($$ select public.pin_approve('770101', null) $$, 'pin_not_allowed', 'a waiter''s number can''t be recorded as an approval');
select throws_ok($$ select public.pin_approve('770999', null) $$, 'pin_not_allowed', 'nor a number nobody has');
select is(public.pin_approve('770102', null), pg_temp.id('boss'), 'a manager''s can, and gives back who');
select is((select details ->> 'employee_number' from public.audit_events where event_type = 'pin_approved' order by id desc limit 1), '770102', 'the approval is in the history, with the number');

-- With a manager ---------------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'quantity', 'line_id', pg_temp.id('taco'), 'quantity', 2), pg_temp.id('boss')) $$,
  'with a manager, a quantity can be lowered');
select is(pg_temp.quantity(pg_temp.id('taco')), 2, '... and it is');
select is((select details ->> 'approved_by' from public.audit_events where event_type = 'ticket_changed' order by id desc limit 1), '770102', 'the change names the manager');
select lives_ok($$ select pg_temp.change(pg_temp.id('ticket'), jsonb_build_object('op', 'remove', 'line_id', pg_temp.id('taco')), pg_temp.id('boss')) $$,
  'with a manager, an item can be removed');

insert into ids select 'whole', pg_temp.save('C3', 'Taco', 1);
select pg_temp.print_kitchen(pg_temp.id('whole'));
select lives_ok($$ select public.cancel_order(pg_temp.id('whole'), pg_temp.version(pg_temp.id('whole')), pg_temp.id('waiter'), null, pg_temp.id('boss')) $$,
  'with a manager, a ticket can be cancelled');
select is((select details ->> 'approved_by' from public.audit_events where event_type = 'ticket_cancelled' order by id desc limit 1), '770102', 'the cancelling names the manager');

-- Security ---------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.pin_approve(text, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.pin_approve(text, uuid)', 'execute'), 'browsers can''t record an approval');
select ok(to_regprocedure('public.change_ticket(bigint, integer, bigint, jsonb, uuid)') is null
          and to_regprocedure('public.cancel_order(bigint, integer, bigint, uuid)') is null, 'nothing is left that goes around the check');

select * from finish();
rollback;
