-- Phase 4: employees, shifts, waiter and chips-runner assignments.
--
-- Rules (owner decisions, Oct 26, 2026):
-- * Roles: waiter, chips runner, manager.
-- * Employee numbers are unique. "01" and "1" count as the same number, so a waiter can type either.
-- * One shift is open at a time. Starting a new shift ends the previous one and its assignments.
-- * Each section has at most one waiter and one chips runner at a time in the open shift.
--   Reassigning ends the old row and adds a new one, so history is kept.
-- * The Bar is open to every waiter: no waiter is assigned there (a chips runner can be).
-- * Waiter duty: waiters and managers. Chips-runner duty: chips runners and managers.
-- * Employees are turned off, never deleted. Turning someone off ends their current duties.
--
-- Employee numbers identify staff; they are not passwords. Sign-in protects the whole app.

-------------------------------------------------------------------------------
-- Roles
-------------------------------------------------------------------------------
create table public.employee_roles (
  code        text primary key check (code ~ '^[a-z_]{3,20}$'),
  name        text not null unique,
  sort_order  smallint not null unique
);

insert into public.employee_roles (code, name, sort_order) values
  ('waiter',       'Waiter',       1),
  ('chips_runner', 'Chips runner', 2),
  ('manager',      'Manager',      3);

-------------------------------------------------------------------------------
-- Employees
-------------------------------------------------------------------------------
create table public.employees (
  id               bigint generated always as identity primary key,
  employee_number  text not null,
  -- "007" -> "7": the number staff type, compared without leading zeros.
  number_key       text generated always as (coalesce(nullif(ltrim(employee_number, '0'), ''), '0')) stored,
  full_name        text not null,
  role_code        text not null references public.employee_roles (code),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.app_users (user_id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint employees_number_format check (employee_number ~ '^[0-9]{1,6}$'),
  constraint employees_name_length check (char_length(btrim(full_name)) between 1 and 80)
);

create unique index employees_number_key on public.employees (number_key);
create unique index employees_employee_number_key on public.employees (employee_number);
create index employees_role_idx on public.employees (role_code);
create index employees_created_by_idx on public.employees (created_by);

create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Shifts
-------------------------------------------------------------------------------
create table public.shifts (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  started_by  uuid references public.app_users (user_id) on delete set null,
  ended_at    timestamptz,
  ended_by    uuid references public.app_users (user_id) on delete set null,
  constraint shifts_end_after_start check (ended_at is null or ended_at >= started_at)
);

create unique index shifts_only_one_open on public.shifts ((true)) where ended_at is null;
create index shifts_started_by_idx on public.shifts (started_by);
create index shifts_ended_by_idx on public.shifts (ended_by);

-------------------------------------------------------------------------------
-- Assignments (history kept: rows are ended, never deleted)
-------------------------------------------------------------------------------
create type public.duty as enum ('waiter', 'chips_runner');

create table public.shift_assignments (
  id            bigint generated always as identity primary key,
  shift_id      bigint not null references public.shifts (id),
  section_code  text not null references public.sections (code) on update cascade,
  duty          public.duty not null,
  employee_id   bigint not null references public.employees (id),
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references public.app_users (user_id) on delete set null,
  ended_at      timestamptz,
  ended_by      uuid references public.app_users (user_id) on delete set null,
  constraint shift_assignments_end_after_start check (ended_at is null or ended_at >= assigned_at)
);

create unique index shift_assignments_one_active
  on public.shift_assignments (shift_id, section_code, duty) where ended_at is null;
create index shift_assignments_shift_idx on public.shift_assignments (shift_id);
create index shift_assignments_section_idx on public.shift_assignments (section_code);
create index shift_assignments_employee_idx on public.shift_assignments (employee_id);
create index shift_assignments_assigned_by_idx on public.shift_assignments (assigned_by);
create index shift_assignments_ended_by_idx on public.shift_assignments (ended_by);

-- Who is on which section right now (open shift, current rows only).
create view public.current_assignments
with (security_invoker = true)
as
select
  a.shift_id,
  a.section_code,
  s.name as section_name,
  a.duty,
  e.id as employee_id,
  e.employee_number,
  e.number_key,
  e.full_name,
  e.role_code,
  a.assigned_at
from public.shift_assignments a
join public.shifts sh on sh.id = a.shift_id and sh.ended_at is null
join public.employees e on e.id = a.employee_id
join public.sections s on s.code = a.section_code
where a.ended_at is null;

-------------------------------------------------------------------------------
-- Audit: more event types
-------------------------------------------------------------------------------
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed'
));

-------------------------------------------------------------------------------
-- start_shift: ends the open shift (and its assignments) and opens a new one.
-------------------------------------------------------------------------------
create function public.start_shift(p_actor uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_old bigint;
  v_new bigint;
begin
  select id into v_old from public.shifts where ended_at is null for update;

  if v_old is not null then
    update public.shift_assignments set ended_at = now(), ended_by = p_actor
     where shift_id = v_old and ended_at is null;
    update public.shifts set ended_at = now(), ended_by = p_actor where id = v_old;
  end if;

  insert into public.shifts (started_by) values (p_actor) returning id into v_new;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'shift_started', jsonb_build_object('shift', v_new, 'previous_shift', v_old));
  return v_new;
end;
$$;

-------------------------------------------------------------------------------
-- assign_duty: put an employee on a section (or clear it with null) in the open shift.
-- Errors: no_open_shift, section_not_found, bar_open_to_all, employee_not_found,
--         employee_inactive, role_mismatch
-------------------------------------------------------------------------------
create function public.assign_duty(
  p_section_code text,
  p_duty         public.duty,
  p_employee_id  bigint,
  p_actor        uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_shift     bigint;
  v_section   public.sections%rowtype;
  v_employee  public.employees%rowtype;
  v_current   public.shift_assignments%rowtype;
begin
  -- Lock the open shift so two managers assigning at once are handled one after the other.
  select id into v_shift from public.shifts where ended_at is null for update;
  if v_shift is null then
    raise exception 'no_open_shift';
  end if;

  select * into v_section from public.sections where code = p_section_code;
  if not found then
    raise exception 'section_not_found' using detail = p_section_code;
  end if;
  if p_duty = 'waiter' and v_section.open_to_all_waiters then
    raise exception 'bar_open_to_all' using detail = v_section.name;
  end if;

  if p_employee_id is not null then
    select * into v_employee from public.employees where id = p_employee_id;
    if not found then
      raise exception 'employee_not_found' using detail = p_employee_id::text;
    end if;
    if not v_employee.is_active then
      raise exception 'employee_inactive' using detail = v_employee.full_name;
    end if;
    if not (v_employee.role_code = 'manager' or v_employee.role_code = p_duty::text) then
      raise exception 'role_mismatch' using detail = v_employee.full_name;
    end if;
  end if;

  select * into v_current from public.shift_assignments
   where shift_id = v_shift and section_code = p_section_code and duty = p_duty and ended_at is null;

  if found and v_current.employee_id is not distinct from p_employee_id then
    return; -- already assigned
  end if;

  if found then
    update public.shift_assignments set ended_at = now(), ended_by = p_actor where id = v_current.id;
  end if;

  if p_employee_id is not null then
    insert into public.shift_assignments (shift_id, section_code, duty, employee_id, assigned_by)
    values (v_shift, p_section_code, p_duty, p_employee_id, p_actor);
  end if;

  insert into public.audit_events (actor_id, event_type, section_code, details)
  values (p_actor, 'assignment_changed', p_section_code, jsonb_build_object(
    'duty', p_duty, 'shift', v_shift, 'from_employee', v_current.employee_id, 'to_employee', p_employee_id));
end;
$$;

-------------------------------------------------------------------------------
-- add_employee. Errors: employee_number_taken, invalid_employee (format checks).
-------------------------------------------------------------------------------
create function public.add_employee(p_number text, p_full_name text, p_role text, p_actor uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
  v_key text := coalesce(nullif(ltrim(btrim(p_number), '0'), ''), '0');
  v_taken text;
begin
  select full_name into v_taken from public.employees where number_key = v_key;
  if v_taken is not null then
    raise exception 'employee_number_taken' using detail = v_taken;
  end if;

  insert into public.employees (employee_number, full_name, role_code, created_by)
  values (btrim(p_number), btrim(p_full_name), p_role, p_actor)
  returning id into v_id;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'employee_added', jsonb_build_object('employee', v_id, 'number', btrim(p_number), 'role', p_role));
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- update_employee: name, role, on/off. Ends current duties the employee can no longer hold.
-- The employee number never changes (it is how staff identify themselves).
-- Errors: employee_not_found
-------------------------------------------------------------------------------
create function public.update_employee(
  p_employee_id bigint,
  p_full_name   text,
  p_role        text,
  p_is_active   boolean,
  p_actor       uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before public.employees%rowtype;
  v_ended  integer;
begin
  select * into v_before from public.employees where id = p_employee_id for update;
  if not found then
    raise exception 'employee_not_found' using detail = p_employee_id::text;
  end if;

  update public.employees
     set full_name = btrim(p_full_name), role_code = p_role, is_active = p_is_active
   where id = p_employee_id;

  update public.shift_assignments a
     set ended_at = now(), ended_by = p_actor
   where a.employee_id = p_employee_id
     and a.ended_at is null
     and (not p_is_active or not (p_role = 'manager' or p_role = a.duty::text));
  get diagnostics v_ended = row_count;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'employee_changed', jsonb_build_object(
    'employee', p_employee_id,
    'name_changed', v_before.full_name is distinct from btrim(p_full_name),
    'role', jsonb_build_object('from', v_before.role_code, 'to', p_role),
    'active', jsonb_build_object('from', v_before.is_active, 'to', p_is_active),
    'duties_ended', v_ended));
end;
$$;

-------------------------------------------------------------------------------
-- Security: RLS on, no browser policies; functions for the server role only.
-------------------------------------------------------------------------------
alter table public.employee_roles enable row level security;
alter table public.employees enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;

revoke all on table
  public.employee_roles, public.employees, public.shifts, public.shift_assignments, public.current_assignments
from anon, authenticated;

revoke execute on function
  public.start_shift(uuid),
  public.assign_duty(text, public.duty, bigint, uuid),
  public.add_employee(text, text, text, uuid),
  public.update_employee(bigint, text, text, boolean, uuid)
from public, anon, authenticated;

grant execute on function
  public.start_shift(uuid),
  public.assign_duty(text, public.duty, bigint, uuid),
  public.add_employee(text, text, text, uuid),
  public.update_employee(bigint, text, text, boolean, uuid)
to service_role;
