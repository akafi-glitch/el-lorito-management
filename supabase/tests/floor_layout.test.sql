-- Database tests for the floor layout (Phase 2). Run with: npx supabase test db
-- Expected values come from the owner's floor drawing and decisions of Oct 26, 2026.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Structure and security --------------------------------------------------------------
select has_table('public', 'sections', 'sections table exists');
select has_table('public', 'restaurant_tables', 'restaurant_tables table exists');
select has_table('public', 'table_combinations', 'table_combinations table exists');
select is(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.floor_areas'::regclass, 'public.sections'::regclass,
                 'public.restaurant_tables'::regclass, 'public.table_combinations'::regclass,
                 'public.table_combination_members'::regclass)),
  true,
  'Row Level Security is on for every floor table'
);

select is_empty(
  $$ select conrelid::regclass::text || '.' || a.attname
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = a.attnum) $$,
  'every foreign key column has an index'
);

-- Tables per section, exactly as drawn --------------------------------------------------
select set_eq(
  $$ select code from public.restaurant_tables where section_code = 'A' $$,
  array['A1','A2','A3','A4','A5','A6'], 'Section A has A1-A6');
select set_eq(
  $$ select code from public.restaurant_tables where section_code = 'B' $$,
  array['B1','B2','B3','B4','B5','B6'], 'Section B has B1-B6');
select set_eq(
  $$ select code from public.restaurant_tables where section_code = 'C' $$,
  array['C1','C2','C3','C4','C5','C6'], 'Section C has C1-C6');
select set_eq(
  $$ select code from public.restaurant_tables where section_code = 'X-1' $$,
  array['X1','X2','X3','X9','X10','X11','X12'], 'X(1) has X1-X3 and X9-X12');
select set_eq(
  $$ select code from public.restaurant_tables where section_code = 'X-2' $$,
  array['X4','X5','X6','X7','X8','X13','X14'], 'X(2) has X4-X8, X13, X14');
select set_eq(
  $$ select code from public.restaurant_tables where section_code = 'P' $$,
  array['P1','P2','P3','P4','P5','P10'], 'Section P has P1-P5 and P10 (no P6-P9)');
select set_eq(
  $$ select label from public.restaurant_tables where section_code = 'PARTY' $$,
  array['Party 1','Party 2','Party 3'], 'Three Party areas');
select set_eq(
  $$ select label from public.restaurant_tables where section_code = 'BAR' $$,
  array['Bar 1','Bar 2','Bar 3','Bar 4'], 'Four Bar spots, tracked as tables');
select is((select count(*)::int from public.restaurant_tables), 45, '45 tables in total');

-- Chairs, as drawn ----------------------------------------------------------------------
select set_eq(
  $$ select code from public.restaurant_tables where capacity = 6 $$,
  array['A4','B4','C1','C2','C3','X6','X7','X8','X10','X11','X12'], '6-chair tables match the drawing');
select set_eq(
  $$ select code from public.restaurant_tables where capacity = 2 $$,
  array['X13','X14'], 'X13 and X14 have 2 chairs');
select is(
  (select count(*)::int from public.restaurant_tables where capacity = 4), 25,
  '25 tables have 4 chairs (A 5, B 5, C 3, X(1) 4, X(2) 2, P 6)');
select is(
  (select count(*)::int from public.restaurant_tables where capacity is null), 7,
  'Party and Bar capacities stay unknown (7 tables)');
select is(
  (select count(*)::int from public.restaurant_tables t join public.sections s on s.code = t.section_code
   where s.kind = 'dining' and t.capacity is null), 0, 'every dining table has a capacity');

-- Rotation and sections -----------------------------------------------------------------
select results_eq(
  $$ select name from public.sections where rotation_order is not null order by rotation_order $$,
  array['A','C','B','X(1)','X(2)','P'], 'rotation is A, C, B, X(1), X(2), P');
select is(
  (select array_agg(code order by code) from public.sections where open_to_all_waiters),
  array['BAR'], 'only the Bar is open to every waiter');

-- Combinations --------------------------------------------------------------------------
select set_eq(
  $$ select code || '=' || capacity from public.table_combination_capacity $$,
  array['A3+A4=10','B3+B4=10','C3+C4=10','A4+B4=12','X6+X7+X8=18'],
  'combined capacity is the sum of chairs');
select results_eq(
  $$ select code from public.table_combinations where allows_over_twelve $$,
  array['X6+X7+X8'], 'only X6 + X7 + X8 may take parties over twelve');

-- Constraints ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.restaurant_tables set capacity = 0 where code = 'A1' $$,
  '23514', null, 'capacity must be at least 1');
select throws_ok(
  $$ insert into public.restaurant_tables (code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order)
     values ('A7', 'A7', 'A', 4, 'A', 1, 1, 7) $$,
  '23505', null, 'two tables cannot share one spot on the map');
select throws_ok(
  $$ update public.sections set rotation_order = 7 where code = 'BAR' $$,
  '23514', null, 'the Bar cannot join the rotation');
select throws_ok(
  $$ insert into public.restaurant_tables (code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order)
     values ('Z1', 'Z1', 'NOPE', 4, 'A', 9, 9, 9) $$,
  '23503', null, 'a table must belong to a real section');
select lives_ok(
  $$ update public.restaurant_tables set capacity = 8 where code = 'PARTY-1' $$,
  'a capacity can be set later without code changes');

-- A combination needs at least two tables (checked at commit).
select throws_ok(
  $$ do $d$
     declare c uuid;
     begin
       insert into public.table_combinations (code, label, sort_order) values ('A1-only', 'A1 only', 99) returning id into c;
       insert into public.table_combination_members values (c, (select id from public.restaurant_tables where code = 'A1'));
       set constraints all immediate;
     end $d$ $$,
  '23514', null, 'a combination of one table is refused');

-- Browsers are refused ------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.restaurant_tables $$, '42501', null, 'anon cannot read tables');
reset role;
set local role authenticated;
select throws_ok($$ update public.sections set is_open = false $$, '42501', null, 'authenticated cannot change sections');
reset role;

select * from finish();
rollback;
