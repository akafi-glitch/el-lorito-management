-- The manager sets the seating rotation for each shift.
--
-- Rules (owner decisions, Nov 2, 2026):
-- * Starting a shift saves its own rotation: an order of the dining sections (A, B, C, X(1), X(2), P).
--   Party and Bar never take part; large parties still go to Party first.
-- * Every new shift starts at the first section of its rotation.
-- * The manager can change the order during the shift. The next suggestion follows the new order
--   straight away, from the section that is next (or another one the manager picks).
-- * Each shift keeps its own rows, so earlier shifts' rotations stay in the history. The rotation
--   pointer (rotation_state) still says which section is next.
-- * sections.rotation_order is now only the starting suggestion for the manager, and what applies
--   when no shift is open.
-- * Seating moves the pointer as before. Starting a shift never touches seated tables or orders.

-------------------------------------------------------------------------------
-- One rotation per shift
-------------------------------------------------------------------------------
create table public.shift_rotation_sections (
  shift_id      bigint not null references public.shifts (id),
  section_code  text not null references public.sections (code) on update cascade,
  position      smallint not null check (position >= 1),
  primary key (shift_id, section_code),
  constraint shift_rotation_sections_position unique (shift_id, position)
);

create index shift_rotation_sections_section_idx on public.shift_rotation_sections (section_code);

comment on table public.shift_rotation_sections is
  'The seating rotation the manager set for each shift. Kept for earlier shifts as history.';

-- Until now the rotation was the same for everyone, so that is what earlier shifts used.
insert into public.shift_rotation_sections (shift_id, section_code, position)
select sh.id, s.code, s.rotation_order
  from public.shifts sh
 cross join public.sections s
 where s.rotation_order is not null;

alter table public.shift_rotation_sections enable row level security;
revoke all on table public.shift_rotation_sections from anon, authenticated;
grant all on table public.shift_rotation_sections to service_role;

create trigger sync_floor_shift_rotation after insert or update or delete on public.shift_rotation_sections
  for each statement execute function public.note_change('floor');

-------------------------------------------------------------------------------
-- current_rotation: the open shift's rotation, or the default when no shift is open.
-------------------------------------------------------------------------------
create function public.current_rotation()
returns table (section_code text, section_position smallint)
language sql
stable
set search_path = ''
as $$
  select r.section_code, r.position
    from public.shift_rotation_sections r
    join public.shifts sh on sh.id = r.shift_id and sh.ended_at is null
  union all
  select s.code, s.rotation_order
    from public.sections s
   where s.rotation_order is not null
     and not exists (select 1 from public.shifts sh
                      join public.shift_rotation_sections r on r.shift_id = sh.id
                     where sh.ended_at is null)
  order by 2
$$;

-------------------------------------------------------------------------------
-- require_valid_rotation: exactly the dining sections, once each. Errors: invalid_rotation
-------------------------------------------------------------------------------
create function public.require_valid_rotation(p_rotation text[])
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_rotation is null
     or array_position(p_rotation, null) is not null
     or cardinality(p_rotation) <> (select count(distinct c) from unnest(p_rotation) c)
     or exists (
       (select unnest(p_rotation))
       except (select code from public.sections where kind = 'dining'))
     or exists (
       (select code from public.sections where kind = 'dining')
       except (select unnest(p_rotation))) then
    raise exception 'invalid_rotation' using detail = coalesce(array_to_string(p_rotation, ', '), 'none');
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- start_shift: ends the open shift (and its assignments), opens a new one with this rotation, and
-- points at the rotation's first section. No rotation given: the default order.
-- Errors: invalid_rotation
-------------------------------------------------------------------------------
drop function public.start_shift(uuid);

create function public.start_shift(p_actor uuid, p_rotation text[] default null)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_old      bigint;
  v_new      bigint;
  v_rotation text[] := p_rotation;
  v_current  text;
begin
  if v_rotation is null then
    select array_agg(code order by rotation_order) into v_rotation from public.sections where rotation_order is not null;
  end if;
  perform public.require_valid_rotation(v_rotation);

  select id into v_old from public.shifts where ended_at is null for update;

  if v_old is not null then
    update public.shift_assignments set ended_at = now(), ended_by = p_actor
     where shift_id = v_old and ended_at is null;
    update public.shifts set ended_at = now(), ended_by = p_actor where id = v_old;
  end if;

  insert into public.shifts (started_by) values (p_actor) returning id into v_new;

  insert into public.shift_rotation_sections (shift_id, section_code, position)
  select v_new, c, o::smallint from unnest(v_rotation) with ordinality as t (c, o);

  select next_section_code into v_current from public.rotation_state where id = 1 for update;
  if v_current is distinct from v_rotation[1] then
    update public.rotation_state set next_section_code = v_rotation[1], updated_at = now() where id = 1;
  end if;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'shift_started', jsonb_build_object(
    'shift', v_new, 'previous_shift', v_old, 'rotation', to_jsonb(v_rotation), 'rotation_next', v_rotation[1]));
  return v_new;
end;
$$;

-------------------------------------------------------------------------------
-- set_shift_rotation: the manager changes the open shift's order. The next section stays as it is,
-- unless the manager picks another. Returns the next section.
-- Errors: no_open_shift, invalid_rotation
-------------------------------------------------------------------------------
create function public.set_shift_rotation(p_rotation text[], p_next_section text, p_actor uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_shift   bigint;
  v_before  text[];
  v_current text;
  v_next    text;
begin
  -- Lock the open shift so two managers changing it at once are handled one after the other.
  select id into v_shift from public.shifts where ended_at is null for update;
  if v_shift is null then
    raise exception 'no_open_shift';
  end if;
  perform public.require_valid_rotation(p_rotation);
  if p_next_section is not null and not (p_next_section = any (p_rotation)) then
    raise exception 'invalid_rotation' using detail = p_next_section;
  end if;

  select array_agg(section_code order by position) into v_before from public.shift_rotation_sections where shift_id = v_shift;
  select next_section_code into v_current from public.rotation_state where id = 1 for update;
  v_next := coalesce(p_next_section, v_current);
  if not (v_next = any (p_rotation)) then
    v_next := p_rotation[1];
  end if;

  if v_before is not distinct from p_rotation and v_next = v_current then
    return v_next; -- nothing changed
  end if;

  if v_before is distinct from p_rotation then
    delete from public.shift_rotation_sections where shift_id = v_shift;
    insert into public.shift_rotation_sections (shift_id, section_code, position)
    select v_shift, c, o::smallint from unnest(p_rotation) with ordinality as t (c, o);
  end if;
  if v_next is distinct from v_current then
    update public.rotation_state set next_section_code = v_next, updated_at = now() where id = 1;
  end if;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'rotation_changed', jsonb_build_object(
    'shift', v_shift, 'from', to_jsonb(v_before), 'to', to_jsonb(p_rotation),
    'next_from', v_current, 'next_to', v_next));
  return v_next;
end;
$$;

-------------------------------------------------------------------------------
-- seat_party: the same, except the pointer moves along the current rotation instead of the fixed one.
-------------------------------------------------------------------------------
create or replace function public.seat_party(
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
  v_used_position    smallint;
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

  -- Move on from the section used (the later one in the rotation if the tables span two sections).
  select max(r.section_position) into v_used_position
    from public.restaurant_tables t
    join public.current_rotation() r on r.section_code = t.section_code
   where t.id = any (v_table_ids);

  if v_used_position is not null then
    select coalesce(
      (select r.section_code from public.current_rotation() r where r.section_position > v_used_position order by r.section_position limit 1),
      (select r.section_code from public.current_rotation() r order by r.section_position limit 1)
    ) into v_next;
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

-- The fixed-order helper has nothing left to do.
drop function public.next_rotation_section(smallint);

-------------------------------------------------------------------------------
-- Security: functions for the server role only.
-------------------------------------------------------------------------------
revoke execute on function
  public.current_rotation(),
  public.require_valid_rotation(text[]),
  public.start_shift(uuid, text[]),
  public.set_shift_rotation(text[], text, uuid)
from public, anon, authenticated;

grant execute on function
  public.current_rotation(),
  public.require_valid_rotation(text[]),
  public.start_shift(uuid, text[]),
  public.set_shift_rotation(text[], text, uuid)
to service_role;
