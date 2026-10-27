-- Phase 2: restaurant floor layout.
-- Sections, tables, and approved combinations, loaded from the owner's hand-drawn floor plan
-- (Oct 26, 2026). Capacities are data: change them with an UPDATE, never in application code.
-- This file changes structure and loads the real layout, so it runs in every environment.

-------------------------------------------------------------------------------
-- Floor areas: the blocks of the floor map and where each sits on screen.
-------------------------------------------------------------------------------
create table public.floor_areas (
  code        text primary key,
  name        text not null unique,
  floor_row   smallint not null check (floor_row >= 1),
  floor_col   smallint not null check (floor_col >= 1),
  row_span    smallint not null default 1 check (row_span >= 1),
  col_span    smallint not null default 1 check (col_span >= 1),
  sort_order  smallint not null unique,
  constraint floor_areas_code_format check (code ~ '^[A-Z]{1,8}$')
);

comment on table public.floor_areas is
  'Blocks of the floor map (A, B, C, BAR, X, P) and their position on the overall floor grid.';

-------------------------------------------------------------------------------
-- Sections: who serves where, the seating rotation, and open/closed state.
-------------------------------------------------------------------------------
create type public.section_kind as enum ('dining', 'party', 'bar');

create table public.sections (
  code                 text primary key,
  name                 text not null unique,
  kind                 public.section_kind not null,
  rotation_order       smallint unique check (rotation_order >= 1),
  is_open              boolean not null default true,
  open_to_all_waiters  boolean not null default false,
  sort_order           smallint not null unique,
  updated_at           timestamptz not null default now(),
  constraint sections_code_format check (code ~ '^[A-Z0-9-]{1,8}$'),
  -- Only dining sections take part in the A, C, B, X(1), X(2), P rotation.
  constraint sections_rotation_dining_only check (kind = 'dining' or rotation_order is null)
);

comment on column public.sections.rotation_order is
  'Position in the seating rotation (1 = first). Null = never recommended by rotation.';
comment on column public.sections.open_to_all_waiters is
  'True when any waiter may bill tables here without a cross-section warning (the Bar).';

create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Restaurant tables.
-------------------------------------------------------------------------------
create table public.restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  label         text not null unique,
  section_code  text not null references public.sections (code) on update cascade,
  capacity      smallint check (capacity between 1 and 60),
  area_code     text not null references public.floor_areas (code) on update cascade,
  layout_row    smallint not null check (layout_row >= 1),
  layout_col    smallint not null check (layout_col >= 1),
  sort_order    smallint not null,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now(),
  constraint restaurant_tables_code_format check (code ~ '^[A-Z0-9-]{1,12}$'),
  constraint restaurant_tables_one_per_cell unique (area_code, layout_row, layout_col),
  constraint restaurant_tables_sort_unique unique (section_code, sort_order)
);

comment on column public.restaurant_tables.capacity is
  'Number of chairs. Null = not confirmed (Party and Bar). Never recommended automatically while null.';

create index restaurant_tables_section_idx on public.restaurant_tables (section_code);

create trigger restaurant_tables_set_updated_at
  before update on public.restaurant_tables
  for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Approved table combinations (pushed-together tables).
-------------------------------------------------------------------------------
create table public.table_combinations (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  label               text not null unique,
  allows_over_twelve  boolean not null default false,
  is_active           boolean not null default true,
  sort_order          smallint not null unique
);

comment on column public.table_combinations.allows_over_twelve is
  'Only combinations with this set may be recommended for parties larger than twelve.';

create table public.table_combination_members (
  combination_id  uuid not null references public.table_combinations (id) on delete cascade,
  table_id        uuid not null references public.restaurant_tables (id),
  primary key (combination_id, table_id)
);

create index table_combination_members_table_idx on public.table_combination_members (table_id);

-- A combination must join at least two tables. Checked at commit time, so a combination and its
-- members can be inserted in one transaction.
create function public.check_combination_has_two_tables()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
  member_count integer;
begin
  if tg_table_name = 'table_combinations' then
    target := new.id;
  elsif tg_op = 'DELETE' then
    target := old.combination_id;
  else
    target := new.combination_id;
  end if;
  if not exists (select 1 from public.table_combinations where id = target) then
    return null; -- combination itself was deleted
  end if;
  select count(*) into member_count from public.table_combination_members where combination_id = target;
  if member_count < 2 then
    raise exception 'Table combination % must join at least two tables (has %)', target, member_count
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger table_combinations_need_two_tables
  after insert on public.table_combinations
  deferrable initially deferred
  for each row execute function public.check_combination_has_two_tables();

create constraint trigger table_combination_members_need_two_tables
  after insert or delete on public.table_combination_members
  deferrable initially deferred
  for each row execute function public.check_combination_has_two_tables();

-- Combined capacity = sum of the chairs (owner decision, Oct 26, 2026).
-- Null when any member's capacity is unknown.
create view public.table_combination_capacity
with (security_invoker = true)
as
select
  c.id as combination_id,
  c.code,
  case when bool_or(t.capacity is null) then null else sum(t.capacity)::integer end as capacity,
  count(*)::integer as table_count
from public.table_combinations c
join public.table_combination_members m on m.combination_id = c.id
join public.restaurant_tables t on t.id = m.table_id
group by c.id, c.code;

-------------------------------------------------------------------------------
-- Security: Row Level Security on, no browser policies. Only the server (secret key) reads.
-------------------------------------------------------------------------------
alter table public.floor_areas enable row level security;
alter table public.sections enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.table_combinations enable row level security;
alter table public.table_combination_members enable row level security;

revoke all on table
  public.floor_areas,
  public.sections,
  public.restaurant_tables,
  public.table_combinations,
  public.table_combination_members,
  public.table_combination_capacity
from anon, authenticated;

-- Helper functions are for triggers only; browsers must not call them.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.check_combination_has_two_tables() from public, anon, authenticated;

-- Every foreign key gets an index (Supabase guidance). Catches up the Phase 1 column too.
create index app_users_created_by_idx on public.app_users (created_by);

-------------------------------------------------------------------------------
-- Layout data from the floor drawing.
-------------------------------------------------------------------------------
insert into public.floor_areas (code, name, floor_row, floor_col, row_span, col_span, sort_order) values
  ('A',   'Section A',          1, 1, 1, 1, 1),
  ('B',   'Section B',          1, 2, 1, 1, 2),
  ('C',   'Section C',          1, 3, 1, 1, 3),
  ('BAR', 'Bar',                2, 1, 1, 2, 4),
  ('X',   'Section X',          3, 1, 1, 2, 5),
  ('P',   'Section P and Party', 2, 3, 2, 1, 6);

insert into public.sections (code, name, kind, rotation_order, open_to_all_waiters, sort_order) values
  ('A',     'A',     'dining', 1,    false, 1),
  ('B',     'B',     'dining', 3,    false, 2),
  ('C',     'C',     'dining', 2,    false, 3),
  ('X-1',   'X(1)',  'dining', 4,    false, 4),
  ('X-2',   'X(2)',  'dining', 5,    false, 5),
  ('P',     'P',     'dining', 6,    false, 6),
  ('PARTY', 'Party', 'party',  null, false, 7),
  ('BAR',   'Bar',   'bar',    null, true,  8);

-- code, label, section, chairs, area, row, col, sort
insert into public.restaurant_tables
  (code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order)
values
  -- Section A (left column A3, A2, A1; right column A4, A5, A6)
  ('A1', 'A1', 'A', 4, 'A', 3, 1, 1),
  ('A2', 'A2', 'A', 4, 'A', 2, 1, 2),
  ('A3', 'A3', 'A', 4, 'A', 1, 1, 3),
  ('A4', 'A4', 'A', 6, 'A', 1, 2, 4),
  ('A5', 'A5', 'A', 4, 'A', 2, 2, 5),
  ('A6', 'A6', 'A', 4, 'A', 3, 2, 6),
  -- Section B (left column B4, B5, B6; right column B3, B2, B1)
  ('B1', 'B1', 'B', 4, 'B', 3, 2, 1),
  ('B2', 'B2', 'B', 4, 'B', 2, 2, 2),
  ('B3', 'B3', 'B', 4, 'B', 1, 2, 3),
  ('B4', 'B4', 'B', 6, 'B', 1, 1, 4),
  ('B5', 'B5', 'B', 4, 'B', 2, 1, 5),
  ('B6', 'B6', 'B', 4, 'B', 3, 1, 6),
  -- Section C (left column C4, C5, C6; right column C3, C2, C1)
  ('C1', 'C1', 'C', 6, 'C', 3, 2, 1),
  ('C2', 'C2', 'C', 6, 'C', 2, 2, 2),
  ('C3', 'C3', 'C', 6, 'C', 1, 2, 3),
  ('C4', 'C4', 'C', 4, 'C', 1, 1, 4),
  ('C5', 'C5', 'C', 4, 'C', 2, 1, 5),
  ('C6', 'C6', 'C', 4, 'C', 3, 1, 6),
  -- Section X(1): X1, X2, X3 (right column), X9, X10, X11, X12 (left column)
  ('X1',  'X1',  'X-1', 4, 'X', 1, 3, 1),
  ('X2',  'X2',  'X-1', 4, 'X', 2, 3, 2),
  ('X3',  'X3',  'X-1', 4, 'X', 3, 3, 3),
  ('X9',  'X9',  'X-1', 4, 'X', 5, 1, 4),
  ('X10', 'X10', 'X-1', 6, 'X', 4, 1, 5),
  ('X11', 'X11', 'X-1', 6, 'X', 3, 1, 6),
  ('X12', 'X12', 'X-1', 6, 'X', 2, 1, 7),
  -- Section X(2): X4, X5 (right column), X6, X7, X8, X13, X14 (middle column)
  ('X4',  'X4',  'X-2', 4, 'X', 4, 3, 1),
  ('X5',  'X5',  'X-2', 4, 'X', 5, 3, 2),
  ('X6',  'X6',  'X-2', 6, 'X', 5, 2, 3),
  ('X7',  'X7',  'X-2', 6, 'X', 4, 2, 4),
  ('X8',  'X8',  'X-2', 6, 'X', 3, 2, 5),
  ('X13', 'X13', 'X-2', 2, 'X', 2, 2, 6),
  ('X14', 'X14', 'X-2', 2, 'X', 1, 2, 7),
  -- Section P: P10 on top, then P1 to P5
  ('P1',  'P1',  'P', 4, 'P', 2, 1, 1),
  ('P2',  'P2',  'P', 4, 'P', 3, 1, 2),
  ('P3',  'P3',  'P', 4, 'P', 4, 1, 3),
  ('P4',  'P4',  'P', 4, 'P', 5, 1, 4),
  ('P5',  'P5',  'P', 4, 'P', 6, 1, 5),
  ('P10', 'P10', 'P', 4, 'P', 1, 1, 6),
  -- Party areas beside P (capacity not confirmed)
  ('PARTY-1', 'Party 1', 'PARTY', null, 'P', 2, 2, 1),
  ('PARTY-2', 'Party 2', 'PARTY', null, 'P', 4, 2, 2),
  ('PARTY-3', 'Party 3', 'PARTY', null, 'P', 6, 2, 3),
  -- Bar seating spots (capacity not confirmed)
  ('BAR-1', 'Bar 1', 'BAR', null, 'BAR', 1, 1, 1),
  ('BAR-2', 'Bar 2', 'BAR', null, 'BAR', 1, 2, 2),
  ('BAR-3', 'Bar 3', 'BAR', null, 'BAR', 1, 3, 3),
  ('BAR-4', 'Bar 4', 'BAR', null, 'BAR', 1, 4, 4);

-- One statement, so each combination and its tables are saved together (the two-table check
-- runs at commit).
with c as (
  insert into public.table_combinations (code, label, allows_over_twelve, sort_order) values
    ('A3+A4',    'A3 + A4',      false, 1),
    ('B3+B4',    'B3 + B4',      false, 2),
    ('C3+C4',    'C3 + C4',      false, 3),
    ('A4+B4',    'A4 + B4',      false, 4),
    ('X6+X7+X8', 'X6 + X7 + X8', true,  5)
  returning id, code
)
insert into public.table_combination_members (combination_id, table_id)
select c.id, t.id
from (values
  ('A3+A4', 'A3'), ('A3+A4', 'A4'),
  ('B3+B4', 'B3'), ('B3+B4', 'B4'),
  ('C3+C4', 'C3'), ('C3+C4', 'C4'),
  ('A4+B4', 'A4'), ('A4+B4', 'B4'),
  ('X6+X7+X8', 'X6'), ('X6+X7+X8', 'X7'), ('X6+X7+X8', 'X8')
) as m(combination_code, table_code)
join c on c.code = m.combination_code
join public.restaurant_tables t on t.code = m.table_code;
