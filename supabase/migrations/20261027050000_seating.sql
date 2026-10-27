-- Phase 3: seating, chips, clearing, section open/close, seating rotation, audit history.
--
-- Rules (owner decisions, Oct 26, 2026):
-- * Occupancy (visit_tables) and chips status (customer_visits.chips_status) are separate facts.
-- * A table can hold one open visit at a time; the database refuses a second one.
-- * Closed sections cannot be seated at all; the host opens the section first.
-- * Seating moves the rotation (A, C, B, X(1), X(2), P) to the section after the one used,
--   whether the table was suggested or tapped by hand. Party and Bar seating don't move it.
-- * The chips runner clears a table after chips were served ("Is the table cleaned?" Yes).
-- * Anyone signed in may join any vacant tables by hand (one visit, several tables).
--
-- Every change goes through one function = one transaction. Only the server may call them.

-------------------------------------------------------------------------------
-- Rotation pointer (single row).
-------------------------------------------------------------------------------
create table public.rotation_state (
  id                 smallint primary key default 1 check (id = 1),
  next_section_code  text not null references public.sections (code) on update cascade,
  updated_at         timestamptz not null default now()
);

create index rotation_state_next_section_idx on public.rotation_state (next_section_code);

insert into public.rotation_state (id, next_section_code)
select 1, code from public.sections where rotation_order = 1;

-------------------------------------------------------------------------------
-- Customer visits: one group of guests from seating until the table is cleared.
-------------------------------------------------------------------------------
create type public.chips_status as enum ('needed', 'served');

create table public.customer_visits (
  id                bigint generated always as identity primary key,
  guest_count       smallint not null check (guest_count between 1 and 100),
  combination_id    uuid references public.table_combinations (id),
  seated_at         timestamptz not null default now(),
  seated_by         uuid references public.app_users (user_id) on delete set null,
  chips_status      public.chips_status not null default 'needed',
  chips_served_at   timestamptz,
  chips_served_by   uuid references public.app_users (user_id) on delete set null,
  cleared_at        timestamptz,
  cleared_by        uuid references public.app_users (user_id) on delete set null,
  version           integer not null default 1 check (version >= 1),
  constraint customer_visits_chips_time check ((chips_status = 'served') = (chips_served_at is not null)),
  constraint customer_visits_cleared_after_seated check (cleared_at is null or cleared_at >= seated_at),
  constraint customer_visits_clear_needs_chips check (cleared_at is null or chips_status = 'served')
);

comment on column public.customer_visits.version is
  'Raised on every change. A change based on an older version is refused (another device changed it first).';

create index customer_visits_open_idx on public.customer_visits (id) where cleared_at is null;
create index customer_visits_combination_idx on public.customer_visits (combination_id);
create index customer_visits_seated_by_idx on public.customer_visits (seated_by);
create index customer_visits_chips_served_by_idx on public.customer_visits (chips_served_by);
create index customer_visits_cleared_by_idx on public.customer_visits (cleared_by);

-------------------------------------------------------------------------------
-- Which tables a visit occupies. Several rows = combined tables.
-------------------------------------------------------------------------------
create table public.visit_tables (
  visit_id     bigint not null references public.customer_visits (id),
  table_id     uuid not null references public.restaurant_tables (id),
  assigned_at  timestamptz not null default now(),
  released_at  timestamptz,
  primary key (visit_id, table_id),
  constraint visit_tables_released_after_assigned check (released_at is null or released_at >= assigned_at)
);

-- THE double-seating guard: at most one open row per table, enforced by the database.
create unique index visit_tables_one_open_visit_per_table
  on public.visit_tables (table_id) where released_at is null;
create index visit_tables_table_idx on public.visit_tables (table_id);

-------------------------------------------------------------------------------
-- Audit history (append-only).
-------------------------------------------------------------------------------
create table public.audit_events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid references public.app_users (user_id) on delete set null,
  event_type    text not null check (event_type in
                  ('seated', 'chips_served', 'cleared', 'section_opened', 'section_closed')),
  visit_id      bigint references public.customer_visits (id),
  section_code  text references public.sections (code) on update cascade,
  details       jsonb not null default '{}'::jsonb
);

create index audit_events_occurred_idx on public.audit_events (occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id);
create index audit_events_visit_idx on public.audit_events (visit_id);
create index audit_events_section_idx on public.audit_events (section_code);

create function public.audit_events_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit history cannot be changed or deleted' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update_or_delete
  before update or delete on public.audit_events
  for each row execute function public.audit_events_are_append_only();

-------------------------------------------------------------------------------
-- Helper: the section after a given one in the rotation (wraps from P back to A).
-------------------------------------------------------------------------------
create function public.next_rotation_section(p_after_order smallint)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select code from public.sections where rotation_order > p_after_order order by rotation_order limit 1),
    (select code from public.sections where rotation_order is not null order by rotation_order limit 1)
  );
$$;

-------------------------------------------------------------------------------
-- seat_party: seat one group at one or more vacant tables.
-- Errors (message = stable key the app turns into plain words; detail = table or section names):
--   invalid_guest_count, no_tables, duplicate_tables, table_not_found, table_inactive,
--   section_closed, table_occupied, combination_not_found, combination_mismatch
-------------------------------------------------------------------------------
create function public.seat_party(
  p_table_codes      text[],
  p_guest_count      integer,
  p_actor            uuid,
  p_combination_code text default null
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_table_ids        uuid[];
  v_found            integer;
  v_bad              text;
  v_combination_id   uuid;
  v_visit_id         bigint;
  v_used_order       smallint;
  v_next             text;
begin
  if p_guest_count is null or p_guest_count < 1 or p_guest_count > 100 then
    raise exception 'invalid_guest_count' using detail = coalesce(p_guest_count::text, 'none');
  end if;
  if p_table_codes is null or cardinality(p_table_codes) = 0 then
    raise exception 'no_tables';
  end if;
  if cardinality(p_table_codes) <> (select count(distinct c) from unnest(p_table_codes) c) then
    raise exception 'duplicate_tables';
  end if;

  -- Lock the chosen tables in a fixed order (by id) so two hosts can never deadlock.
  select array_agg(t.id order by t.id), count(*)
    into v_table_ids, v_found
  from (
    select id from public.restaurant_tables
    where code = any (p_table_codes)
    order by id
    for update
  ) t;

  if v_found <> cardinality(p_table_codes) then
    select string_agg(c, ', ') into v_bad
    from unnest(p_table_codes) c
    where not exists (select 1 from public.restaurant_tables where code = c);
    raise exception 'table_not_found' using detail = v_bad;
  end if;

  select string_agg(label, ', ' order by label) into v_bad
  from public.restaurant_tables where id = any (v_table_ids) and not is_active;
  if v_bad is not null then
    raise exception 'table_inactive' using detail = v_bad;
  end if;

  select string_agg(distinct s.name, ', ') into v_bad
  from public.restaurant_tables t join public.sections s on s.code = t.section_code
  where t.id = any (v_table_ids) and not s.is_open;
  if v_bad is not null then
    raise exception 'section_closed' using detail = v_bad;
  end if;

  select string_agg(t.label, ', ' order by t.label) into v_bad
  from public.visit_tables vt join public.restaurant_tables t on t.id = vt.table_id
  where vt.table_id = any (v_table_ids) and vt.released_at is null;
  if v_bad is not null then
    raise exception 'table_occupied' using detail = v_bad;
  end if;

  if p_combination_code is not null then
    select id into v_combination_id
    from public.table_combinations where code = p_combination_code and is_active;
    if v_combination_id is null then
      raise exception 'combination_not_found' using detail = p_combination_code;
    end if;
    if exists (
      (select table_id from public.table_combination_members where combination_id = v_combination_id)
      except (select unnest(v_table_ids))
    ) or exists (
      (select unnest(v_table_ids))
      except (select table_id from public.table_combination_members where combination_id = v_combination_id)
    ) then
      raise exception 'combination_mismatch' using detail = p_combination_code;
    end if;
  end if;

  insert into public.customer_visits (guest_count, combination_id, seated_by)
  values (p_guest_count, v_combination_id, p_actor)
  returning id into v_visit_id;

  insert into public.visit_tables (visit_id, table_id)
  select v_visit_id, unnest(v_table_ids);

  -- Move the rotation on from the section used (the later one if the tables span two sections).
  select max(s.rotation_order) into v_used_order
  from public.restaurant_tables t join public.sections s on s.code = t.section_code
  where t.id = any (v_table_ids);

  if v_used_order is not null then
    v_next := public.next_rotation_section(v_used_order);
    update public.rotation_state set next_section_code = v_next, updated_at = now() where id = 1;
  end if;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  select p_actor, 'seated', v_visit_id, jsonb_build_object(
    'tables', (select jsonb_agg(label order by label) from public.restaurant_tables where id = any (v_table_ids)),
    'guest_count', p_guest_count,
    'combination', p_combination_code,
    'rotation_next', v_next
  );

  return v_visit_id;
end;
$$;

-------------------------------------------------------------------------------
-- Shared check for visit changes: explains why an update matched no row.
-- Errors: visit_not_found, visit_closed, stale_visit, plus the reason passed in.
-------------------------------------------------------------------------------
create function public.raise_visit_change_refused(p_visit_id bigint, p_expected_version integer, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.customer_visits%rowtype;
begin
  select * into v from public.customer_visits where id = p_visit_id;
  if not found then
    raise exception 'visit_not_found' using detail = p_visit_id::text;
  elsif v.cleared_at is not null then
    raise exception 'visit_closed' using detail = p_visit_id::text;
  elsif v.version <> p_expected_version then
    raise exception 'stale_visit' using detail = p_visit_id::text;
  else
    raise exception '%', p_reason using detail = p_visit_id::text;
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- mark_chips_served: yellow to red. Errors: see raise_visit_change_refused, chips_already_served.
-------------------------------------------------------------------------------
create function public.mark_chips_served(p_visit_id bigint, p_expected_version integer, p_actor uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_version integer;
begin
  update public.customer_visits
     set chips_status = 'served', chips_served_at = now(), chips_served_by = p_actor, version = version + 1
   where id = p_visit_id and cleared_at is null and chips_status = 'needed' and version = p_expected_version
  returning version into v_version;

  if v_version is null then
    perform public.raise_visit_change_refused(p_visit_id, p_expected_version, 'chips_already_served');
  end if;

  insert into public.audit_events (actor_id, event_type, visit_id) values (p_actor, 'chips_served', p_visit_id);
  return v_version;
end;
$$;

-------------------------------------------------------------------------------
-- clear_visit: the chips runner confirms the table is cleaned. Red to green; the visit closes,
-- its tables are released, and everything recorded for the visit is kept.
-- Errors: see raise_visit_change_refused, chips_not_served.
-------------------------------------------------------------------------------
create function public.clear_visit(p_visit_id bigint, p_expected_version integer, p_actor uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_version integer;
begin
  update public.customer_visits
     set cleared_at = now(), cleared_by = p_actor, version = version + 1
   where id = p_visit_id and cleared_at is null and chips_status = 'served' and version = p_expected_version
  returning version into v_version;

  if v_version is null then
    perform public.raise_visit_change_refused(p_visit_id, p_expected_version, 'chips_not_served');
  end if;

  update public.visit_tables set released_at = now() where visit_id = p_visit_id and released_at is null;

  insert into public.audit_events (actor_id, event_type, visit_id) values (p_actor, 'cleared', p_visit_id);
  return v_version;
end;
$$;

-------------------------------------------------------------------------------
-- set_section_open: open or close a section. Tables already seated keep their status.
-- Errors: section_not_found.
-------------------------------------------------------------------------------
create function public.set_section_open(p_section_code text, p_is_open boolean, p_actor uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_was_open boolean;
begin
  select is_open into v_was_open from public.sections where code = p_section_code for update;
  if not found then
    raise exception 'section_not_found' using detail = p_section_code;
  end if;

  if v_was_open is distinct from p_is_open then
    update public.sections set is_open = p_is_open where code = p_section_code;
    insert into public.audit_events (actor_id, event_type, section_code)
    values (p_actor, case when p_is_open then 'section_opened' else 'section_closed' end, p_section_code);
  end if;

  return p_is_open;
end;
$$;

-------------------------------------------------------------------------------
-- Security: RLS on, no browser policies; functions callable by the server (service_role) only.
-------------------------------------------------------------------------------
alter table public.rotation_state enable row level security;
alter table public.customer_visits enable row level security;
alter table public.visit_tables enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.rotation_state, public.customer_visits, public.visit_tables, public.audit_events
  from anon, authenticated;

revoke execute on function
  public.audit_events_are_append_only(),
  public.next_rotation_section(smallint),
  public.seat_party(text[], integer, uuid, text),
  public.raise_visit_change_refused(bigint, integer, text),
  public.mark_chips_served(bigint, integer, uuid),
  public.clear_visit(bigint, integer, uuid),
  public.set_section_open(text, boolean, uuid)
from public, anon, authenticated;

grant execute on function
  public.next_rotation_section(smallint),
  public.raise_visit_change_refused(bigint, integer, text),
  public.seat_party(text[], integer, uuid, text),
  public.mark_chips_served(bigint, integer, uuid),
  public.clear_visit(bigint, integer, uuid),
  public.set_section_open(text, boolean, uuid)
to service_role;
