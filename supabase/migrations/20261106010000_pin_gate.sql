-- A PIN in front of Order History and the Shift Report. Each manager has their own PIN. Only its bcrypt hash
-- is stored, and the app works it out and compares it: PINs never reach the database or the history.
-- Nothing here is open to browsers: these tables have Row Level Security on and no policies.

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'chips_undone', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'shift_finished', 'rotation_changed', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed', 'sections_remapped',
  'ticket_saved', 'ticket_cancelled', 'ticket_changed', 'order_saved',
  'ticket_printed', 'ticket_reprinted', 'print_outcome',
  'kitchen_print_requested', 'customer_print_requested', 'ticket_finalized',
  'pin_login', 'pin_failed', 'pin_lockout', 'pin_locked', 'pin_set', 'pin_disabled'
));

create table public.employee_pins (
  employee_id bigint primary key references public.employees (id),
  pin_hash    text not null check (pin_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  set_at      timestamptz not null default now(),
  set_by      uuid references public.app_users (user_id) on delete set null,
  disabled_at timestamptz
);
create index employee_pins_set_by_idx on public.employee_pins (set_by);

-- Tries per typed number, whether or not anyone has that number, so a lockout says nothing about who exists.
-- The key is a hash: someone typing their PIN into the number box must not leave it readable here.
create table public.pin_attempts (
  attempt_key    text primary key,
  failed_count   smallint not null default 0,
  locked_until   timestamptz,
  lockout_logged boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table public.pin_sessions (
  id           bigint generated always as identity primary key,
  -- SHA-256 of the cookie's random token: reading this table doesn't give anyone a working cookie.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  employee_id  bigint not null references public.employees (id),
  user_id      uuid not null references public.app_users (user_id),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '12 hours',
  ended_at     timestamptz,
  ended_reason text
);
create index pin_sessions_employee_idx on public.pin_sessions (employee_id);
create index pin_sessions_user_idx on public.pin_sessions (user_id);

alter table public.employee_pins enable row level security;
alter table public.pin_attempts enable row level security;
alter table public.pin_sessions enable row level security;

revoke all on table public.employee_pins, public.pin_attempts, public.pin_sessions from public, anon, authenticated;
grant all on table public.employee_pins, public.pin_attempts, public.pin_sessions to service_role;

-------------------------------------------------------------------------------
-- The employee behind a typed number ("007" finds "7"), or null.
-------------------------------------------------------------------------------
create function public.pin_employee(p_number text)
returns public.employees
language sql
stable
set search_path = ''
as $$
  select e.* from public.employees e
   where e.number_key = coalesce(nullif(ltrim(p_number, '0'), ''), '0')
$$;

create function public.pin_attempt_key(p_number text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(nullif(ltrim(p_number, '0'), ''), '0'), 'UTF8')), 'hex')
$$;

-------------------------------------------------------------------------------
-- pin_reserve_attempt: uses up one try BEFORE the PIN is compared, so tries sent at the same moment can't
-- get past five. The fifth starts the 10-minute lockout; a correct PIN on it lifts it again.
-- pin_hash is null when this number can't open these areas: the app still compares, against a dummy.
-------------------------------------------------------------------------------
create function public.pin_reserve_attempt(p_number text)
returns table (allowed boolean, employee_id bigint, pin_hash text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key     text := public.pin_attempt_key(p_number);
  v_attempt public.pin_attempts%rowtype;
begin
  insert into public.pin_attempts (attempt_key) values (v_key) on conflict (attempt_key) do nothing;
  select * into v_attempt from public.pin_attempts a where a.attempt_key = v_key for update;

  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return query select false, null::bigint, null::text;
    return;
  end if;

  update public.pin_attempts a
     set failed_count = case when v_attempt.locked_until is null then a.failed_count + 1 else 1 end,
         locked_until = case when v_attempt.locked_until is null and a.failed_count + 1 >= 5 then now() + interval '10 minutes' end,
         lockout_logged = false,
         updated_at = now()
   where a.attempt_key = v_key;

  return query
    select true, e.id, p.pin_hash
      from (select 1) one
      left join public.employees e
        on e.number_key = coalesce(nullif(ltrim(p_number, '0'), ''), '0') and e.is_active and e.role_code = 'manager'
      left join public.employee_pins p on p.employee_id = e.id and p.disabled_at is null;
end;
$$;

-------------------------------------------------------------------------------
-- pin_login_success: the PIN matched. Clears the tries and opens a session. Errors: pin_not_allowed
-------------------------------------------------------------------------------
create function public.pin_login_success(p_number text, p_token_hash text, p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_employee public.employees;
begin
  v_employee := public.pin_employee(p_number);
  if v_employee.id is null or not v_employee.is_active or v_employee.role_code <> 'manager'
     or not exists (select 1 from public.employee_pins p where p.employee_id = v_employee.id and p.disabled_at is null) then
    raise exception 'pin_not_allowed';
  end if;

  delete from public.pin_attempts where attempt_key = public.pin_attempt_key(p_number);
  insert into public.pin_sessions (token_hash, employee_id, user_id) values (p_token_hash, v_employee.id, p_user_id);
  insert into public.audit_events (actor_id, event_type, details)
  values (p_user_id, 'pin_login', jsonb_build_object('employee_number', v_employee.employee_number));
end;
$$;

-------------------------------------------------------------------------------
-- pin_login_failed: records a wrong PIN, and the lockout once. Returns whether the number is locked now.
-- A number nobody has is recorded as null: it could be a PIN typed into the wrong box.
-------------------------------------------------------------------------------
create function public.pin_login_failed(p_number text, p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_number text := (public.pin_employee(p_number)).employee_number;
  v_key    text := public.pin_attempt_key(p_number);
  v_locked boolean;
  v_first  boolean;
begin
  insert into public.audit_events (actor_id, event_type, details)
  values (p_user_id, 'pin_failed', jsonb_build_object('employee_number', v_number));

  select coalesce(a.locked_until > now(), false), coalesce(a.locked_until > now(), false) and not a.lockout_logged
    into v_locked, v_first
    from public.pin_attempts a where a.attempt_key = v_key for update;
  if v_first then
    update public.pin_attempts set lockout_logged = true where attempt_key = v_key;
    insert into public.audit_events (actor_id, event_type, details)
    values (p_user_id, 'pin_lockout', jsonb_build_object('employee_number', v_number));
  end if;
  return coalesce(v_locked, false);
end;
$$;

-------------------------------------------------------------------------------
-- pin_session_check: who this session belongs to, if it is still good. Changes nothing, so a screen
-- refreshing itself never counts as someone being there. Ends after 15 minutes idle and 12 hours at most,
-- and at once if the employee stops being an active manager or their PIN is turned off.
-------------------------------------------------------------------------------
create function public.pin_session_check(p_token_hash text, p_user_id uuid)
returns table (employee_number text, full_name text, expires_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select e.employee_number, e.full_name, s.expires_at
    from public.pin_sessions s
    join public.employees e on e.id = s.employee_id
    join public.employee_pins p on p.employee_id = e.id
   where s.token_hash = p_token_hash
     and s.user_id = p_user_id
     and s.ended_at is null
     and now() < s.expires_at
     and now() < s.last_seen_at + interval '15 minutes'
     and e.is_active
     and e.role_code = 'manager'
     and p.disabled_at is null
$$;

-------------------------------------------------------------------------------
-- pin_session_touch: someone really is using the screen. Returns whether the session is still good.
-------------------------------------------------------------------------------
create function public.pin_session_touch(p_token_hash text, p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pin_session_check(p_token_hash, p_user_id)) then
    return false;
  end if;
  update public.pin_sessions set last_seen_at = now() where token_hash = p_token_hash and ended_at is null;
  return true;
end;
$$;

-------------------------------------------------------------------------------
-- pin_session_end: Lock, or signing out of the app. Ending one twice changes nothing.
-------------------------------------------------------------------------------
create function public.pin_session_end(p_token_hash text, p_user_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_number text;
begin
  update public.pin_sessions s
     set ended_at = now(), ended_reason = p_reason
    from public.employees e
   where s.token_hash = p_token_hash and s.ended_at is null and e.id = s.employee_id
  returning e.employee_number into v_number;

  if v_number is not null then
    insert into public.audit_events (actor_id, event_type, details)
    values (p_user_id, 'pin_locked', jsonb_build_object('employee_number', v_number, 'reason', p_reason));
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- set_manager_pin: sets or resets a manager's PIN, from the admin script. Ends their open sessions and clears
-- their tries. Errors: employee_not_found, employee_inactive, not_a_manager
-------------------------------------------------------------------------------
create function public.set_manager_pin(p_number text, p_pin_hash text, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_employee public.employees;
begin
  v_employee := public.pin_employee(p_number);
  if v_employee.id is null then
    raise exception 'employee_not_found';
  end if;
  if not v_employee.is_active then
    raise exception 'employee_inactive';
  end if;
  if v_employee.role_code <> 'manager' then
    raise exception 'not_a_manager';
  end if;

  insert into public.employee_pins (employee_id, pin_hash, set_by)
  values (v_employee.id, p_pin_hash, p_actor)
  on conflict (employee_id) do update
    set pin_hash = excluded.pin_hash, set_at = now(), set_by = excluded.set_by, disabled_at = null;

  update public.pin_sessions set ended_at = now(), ended_reason = 'pin_changed' where employee_id = v_employee.id and ended_at is null;
  delete from public.pin_attempts where attempt_key = public.pin_attempt_key(p_number);

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'pin_set', jsonb_build_object('employee_number', v_employee.employee_number));
end;
$$;

-------------------------------------------------------------------------------
-- disable_manager_pin: turns a PIN off, and ends that employee's sessions. Errors: employee_not_found, no_pin
-------------------------------------------------------------------------------
create function public.disable_manager_pin(p_number text, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_employee public.employees;
begin
  v_employee := public.pin_employee(p_number);
  if v_employee.id is null then
    raise exception 'employee_not_found';
  end if;

  update public.employee_pins set disabled_at = now() where employee_id = v_employee.id and disabled_at is null;
  if not found then
    raise exception 'no_pin';
  end if;
  update public.pin_sessions set ended_at = now(), ended_reason = 'pin_disabled' where employee_id = v_employee.id and ended_at is null;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'pin_disabled', jsonb_build_object('employee_number', v_employee.employee_number));
end;
$$;

-------------------------------------------------------------------------------
-- Security: functions for the server role only.
-------------------------------------------------------------------------------
revoke execute on function
  public.pin_employee(text),
  public.pin_attempt_key(text),
  public.pin_reserve_attempt(text),
  public.pin_login_success(text, text, uuid),
  public.pin_login_failed(text, uuid),
  public.pin_session_check(text, uuid),
  public.pin_session_touch(text, uuid),
  public.pin_session_end(text, uuid, text),
  public.set_manager_pin(text, text, uuid),
  public.disable_manager_pin(text, uuid)
from public, anon, authenticated;

grant execute on function
  public.pin_employee(text),
  public.pin_attempt_key(text),
  public.pin_reserve_attempt(text),
  public.pin_login_success(text, text, uuid),
  public.pin_login_failed(text, uuid),
  public.pin_session_check(text, uuid),
  public.pin_session_touch(text, uuid),
  public.pin_session_end(text, uuid, text),
  public.set_manager_pin(text, text, uuid),
  public.disable_manager_pin(text, uuid)
to service_role;
