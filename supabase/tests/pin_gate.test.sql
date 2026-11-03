-- Database tests: the PIN gate's lockout, sessions, history, and that browsers can't reach any of it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ce', 'pinmgr@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000ce', 'pinmgr', 'Pin Manager');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cf', 'pinother@staff.ellorito-management.com');
insert into public.app_users (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000cf', 'pinother', 'Pin Other');

create function pg_temp.actor() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000ce'::uuid $$;
create function pg_temp.other() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000cf'::uuid $$;
create function pg_temp.hash(p text default 'a') returns text language sql as $$ select '$2b$04$' || repeat(p, 53) $$;
create function pg_temp.token(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.good(p text) returns boolean language sql as $$
  select exists (select 1 from public.pin_session_check(pg_temp.token(p), pg_temp.actor())) $$;
create function pg_temp.events(p_type text) returns bigint language sql as $$ select count(*) from public.audit_events where event_type = p_type $$;
create function pg_temp.last_number(p_type text) returns text language sql as $$
  select details ->> 'employee_number' from public.audit_events where event_type = p_type order by id desc limit 1 $$;

-- Don't send real live signals from a test (this replacement is rolled back at the end).
create or replace function public.send_live_signal(p_topic text, p_version bigint)
returns void language sql as $$ select $$;

select public.add_employee('770001', 'Pin Boss', 'manager', pg_temp.actor());
select public.add_employee('770002', 'Pin Waiter', 'waiter', pg_temp.actor());
select public.add_employee('770003', 'Pin Boss Two', 'manager', pg_temp.actor());

-- Setting a PIN --------------------------------------------------------------------------------------
select throws_ok($$ select public.set_manager_pin('770002', pg_temp.hash(), pg_temp.actor()) $$, 'not_a_manager', 'only a manager can have a PIN');
select throws_ok($$ select public.set_manager_pin('770999', pg_temp.hash(), pg_temp.actor()) $$, 'employee_not_found', 'an unknown number can''t have a PIN');
select throws_ok($$ select public.set_manager_pin('770001', '482913', pg_temp.actor()) $$, '23514', null, 'a plain PIN can''t be stored: only a bcrypt hash fits');
select lives_ok($$ select public.set_manager_pin('770001', pg_temp.hash(), pg_temp.actor()) $$, 'a manager can have a PIN');
select is(pg_temp.last_number('pin_set'), '770001', 'the history records it, with the number');
select ok((select details::text not like '%$2b$%' from public.audit_events where event_type = 'pin_set' order by id desc limit 1), '... and not the hash');

-- Who has a PIN --------------------------------------------------------------------------------------
select is((select pin_hash from public.pin_reserve_attempt('770001')), pg_temp.hash(), 'a manager''s PIN can be compared');
select is((select pin_hash from public.pin_reserve_attempt('770002')), null, 'a waiter has nothing to compare');
select is((select pin_hash from public.pin_reserve_attempt('770003')), null, 'a manager with no PIN has nothing to compare');
select is((select pin_hash from public.pin_reserve_attempt('770999')), null, 'neither has a number nobody has');
select ok((select allowed from public.pin_reserve_attempt('770999')), '... and the answer looks the same');

-- The lockout ----------------------------------------------------------------------------------------
select public.set_manager_pin('770003', pg_temp.hash('b'), pg_temp.actor()); -- starts with no tries used
select lives_ok($$ select public.pin_login_failed('770003', pg_temp.actor()) $$, 'a wrong PIN is recorded');
select is(pg_temp.last_number('pin_failed'), '770003', '... with the employee number');
select ok((select allowed from public.pin_reserve_attempt('770003')), 'try 1');
select ok((select allowed from public.pin_reserve_attempt('770003')), 'try 2');
select ok((select allowed from public.pin_reserve_attempt('770003')), 'try 3');
select ok((select allowed from public.pin_reserve_attempt('770003')), 'try 4');
select is(public.pin_login_failed('770003', pg_temp.actor()), false, 'after four wrong tries, not locked yet');
select ok((select allowed from public.pin_reserve_attempt('770003')), 'try 5 is still checked');
create temp table before_lock as select pg_temp.events('pin_lockout') as n;
select is(public.pin_login_failed('770003', pg_temp.actor()), true, 'the fifth wrong try locks it');
select is(pg_temp.events('pin_lockout'), (select n from before_lock) + 1, 'the lockout is in the history');
select is(pg_temp.last_number('pin_lockout'), '770003', '... with the employee number');
select is(public.pin_login_failed('770003', pg_temp.actor()), true, 'it stays locked');
select is(pg_temp.events('pin_lockout'), (select n from before_lock) + 1, '... and is recorded once');
select is((select allowed from public.pin_reserve_attempt('770003')), false, 'during the lockout a try isn''t allowed, even a right one');
select is((select pin_hash from public.pin_reserve_attempt('770003')), null, '... and nothing is handed out to compare');
select ok((select locked_until between now() + interval '9 minutes' and now() + interval '10 minutes'
             from public.pin_attempts where attempt_key = public.pin_attempt_key('770003')), 'it lasts 10 minutes');
update public.pin_attempts set locked_until = now() - interval '1 second' where attempt_key = public.pin_attempt_key('770003');
select ok((select allowed from public.pin_reserve_attempt('770003')), 'afterwards tries are allowed again');
select is((select failed_count::int from public.pin_attempts where attempt_key = public.pin_attempt_key('770003')), 1, '... counted from the start');
select ok((select attempt_key !~ '770003' from public.pin_attempts where attempt_key = public.pin_attempt_key('770003')), 'a typed number isn''t kept readable');

-- Sessions -------------------------------------------------------------------------------------------
select public.pin_login_success('770001', pg_temp.token('one'), pg_temp.actor());
select ok(pg_temp.good('one'), 'a correct PIN opens a session');
select is(pg_temp.last_number('pin_login'), '770001', 'the login is in the history, with the number');
select is((select count(*) from public.pin_attempts where attempt_key = public.pin_attempt_key('770001')), 0::bigint, '... and the tries are cleared');
select is((select count(*) from public.pin_session_check(pg_temp.token('one'), pg_temp.other())), 0::bigint, 'it only works for the account that unlocked it');
select ok(not exists (select 1 from public.pin_session_check(pg_temp.token('nope'), pg_temp.actor())), 'a made-up token gets nothing');

update public.pin_sessions set last_seen_at = now() - interval '14 minutes' where token_hash = pg_temp.token('one');
select is(public.pin_session_touch(pg_temp.token('one'), pg_temp.actor()), true, 'using it within 15 minutes keeps it');
update public.pin_sessions set last_seen_at = now() - interval '16 minutes' where token_hash = pg_temp.token('one');
select ok(not pg_temp.good('one'), 'after 15 minutes idle it has ended');
select is(public.pin_session_touch(pg_temp.token('one'), pg_temp.actor()), false, '... and can''t be brought back');

select public.pin_login_success('770001', pg_temp.token('two'), pg_temp.actor());
update public.pin_sessions set expires_at = now() - interval '1 second' where token_hash = pg_temp.token('two');
select is(public.pin_session_touch(pg_temp.token('two'), pg_temp.actor()), false, 'at 12 hours it has ended, however busy');

select public.pin_login_success('770001', pg_temp.token('three'), pg_temp.actor());
select public.pin_session_end(pg_temp.token('three'), pg_temp.actor(), 'lock');
select ok(not pg_temp.good('three'), 'Lock ends it at once');
select is(pg_temp.last_number('pin_locked'), '770001', '... and is in the history, with the number');

select public.pin_login_success('770001', pg_temp.token('four'), pg_temp.actor());
select public.update_employee((select id from public.employees where employee_number = '770001'), 'Pin Boss', 'waiter', true, pg_temp.actor());
select ok(not pg_temp.good('four'), 'someone who stops being a manager loses access at once');
select public.update_employee((select id from public.employees where employee_number = '770001'), 'Pin Boss', 'manager', true, pg_temp.actor());

select public.disable_manager_pin('770001', pg_temp.actor());
select ok(not pg_temp.good('four'), 'turning a PIN off ends their sessions');
select throws_ok($$ select public.pin_login_success('770001', pg_temp.token('five'), pg_temp.actor()) $$, 'pin_not_allowed', 'and no new one can open');

select * from finish();
rollback;
