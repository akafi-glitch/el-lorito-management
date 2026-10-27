-- Phase 7: tickets (saved orders), editable until printed.
--
-- Rules (owner decisions, Oct 26-27, 2026):
-- * A ticket belongs to one customer visit (the group seated at a table) and to the waiter who made it.
-- * A visit can have any number of tickets. Ticket numbers start at 1001 and never reset.
-- * A ticket can be changed until it is printed (Phase 9). Printing locks it for good.
-- * Item name, price, and tax category are copied onto the ticket when the item is first added,
--   so later menu changes never alter a ticket.
-- * Lunch items cost $1.00 more from 3:00 PM restaurant time (data on the Lunch category). The
--   database decides the price when the item is added, using the restaurant's time zone.
-- * An item already on the ticket keeps its saved price when the ticket is changed (quantity or
--   order). An item removed and saved, then added again later, is priced again.
-- * A saved ticket that isn't printed can be cancelled; it stays in the history.
-- * When the table is cleared (visit closed), its tickets can no longer be changed.
--
-- Money: whole cents. Every change is recorded in audit_events.

-------------------------------------------------------------------------------
-- Tickets
-------------------------------------------------------------------------------
create type public.ticket_status as enum ('open', 'printed', 'cancelled');

create sequence public.ticket_number_seq start with 1001 minvalue 1001;

create table public.tickets (
  id                          bigint generated always as identity primary key,
  ticket_number               bigint not null unique default nextval('public.ticket_number_seq'),
  visit_id                    bigint not null references public.customer_visits (id),
  employee_id                 bigint not null references public.employees (id),
  status                      public.ticket_status not null default 'open',
  version                     integer not null default 1 check (version >= 1),
  created_at                  timestamptz not null default now(),
  created_by                  uuid references public.app_users (user_id) on delete set null,
  updated_at                  timestamptz not null default now(),
  last_edited_by_employee_id  bigint references public.employees (id),
  printed_at                  timestamptz,
  cancelled_at                timestamptz,
  cancelled_by_employee_id    bigint references public.employees (id),
  constraint tickets_printed_time check ((status = 'printed') = (printed_at is not null)),
  constraint tickets_cancelled_time check ((status = 'cancelled') = (cancelled_at is not null))
);

alter sequence public.ticket_number_seq owned by public.tickets.ticket_number;

comment on column public.tickets.employee_id is 'The waiter who made the ticket (kept even if someone else edits it).';
comment on column public.tickets.version is 'Raised on every change; a change based on an older version is refused.';

create index tickets_visit_idx on public.tickets (visit_id);
create index tickets_employee_idx on public.tickets (employee_id);
create index tickets_created_by_idx on public.tickets (created_by);
create index tickets_last_edited_by_idx on public.tickets (last_edited_by_employee_id);
create index tickets_cancelled_by_idx on public.tickets (cancelled_by_employee_id);

create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

create table public.ticket_lines (
  id                    bigint generated always as identity primary key,
  ticket_id             bigint not null references public.tickets (id),
  line_no               smallint not null check (line_no between 1 and 100),
  menu_item_id          bigint not null references public.menu_items (id),
  item_name             text not null check (char_length(item_name) between 1 and 80),
  unit_price_cents      integer not null check (unit_price_cents between 0 and 1100000),
  -- The part of unit_price_cents that is the late (after 3:00 PM) amount; 0 otherwise.
  late_surcharge_cents  integer not null default 0 check (late_surcharge_cents between 0 and unit_price_cents),
  quantity              smallint not null check (quantity between 1 and 99),
  tax_category_code     text not null references public.tax_categories (code),
  tax_group_code        text not null references public.tax_groups (code),
  added_at              timestamptz not null default now(),
  constraint ticket_lines_line_no unique (ticket_id, line_no),
  constraint ticket_lines_one_line_per_item unique (ticket_id, menu_item_id)
);

create index ticket_lines_menu_item_idx on public.ticket_lines (menu_item_id);
create index ticket_lines_tax_category_idx on public.ticket_lines (tax_category_code);
create index ticket_lines_tax_group_idx on public.ticket_lines (tax_group_code);

-------------------------------------------------------------------------------
-- Audit: ticket events
-------------------------------------------------------------------------------
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed',
  'ticket_saved', 'ticket_cancelled'
));

-------------------------------------------------------------------------------
-- Shared checks: the waiter is active; the visit is open (and stays open until we commit).
-------------------------------------------------------------------------------
create function public.require_active_employee(p_employee_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.employees%rowtype;
begin
  select * into v from public.employees where id = p_employee_id;
  if not found then
    raise exception 'employee_not_found' using detail = coalesce(p_employee_id::text, '');
  end if;
  if not v.is_active then
    raise exception 'employee_inactive' using detail = v.full_name;
  end if;
end;
$$;

create function public.lock_open_visit(p_visit_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_cleared timestamptz;
begin
  -- FOR SHARE: clearing the table waits for this change to finish (and the other way round).
  select cleared_at into v_cleared from public.customer_visits where id = p_visit_id for share;
  if not found then
    raise exception 'visit_not_found' using detail = coalesce(p_visit_id::text, '');
  end if;
  if v_cleared is not null then
    raise exception 'visit_closed' using detail = p_visit_id::text;
  end if;
end;
$$;

-- Locks an open ticket of this visit at the expected version, or explains why not.
create function public.lock_open_ticket(p_ticket_id bigint, p_visit_id bigint, p_expected_version integer)
returns public.tickets
language plpgsql
set search_path = ''
as $$
declare
  v public.tickets%rowtype;
begin
  select * into v from public.tickets where id = p_ticket_id and visit_id = p_visit_id for update;
  if not found then
    raise exception 'ticket_not_found' using detail = coalesce(p_ticket_id::text, '');
  end if;
  if v.status = 'printed' then
    raise exception 'ticket_printed' using detail = v.ticket_number::text;
  end if;
  if v.status = 'cancelled' then
    raise exception 'ticket_cancelled' using detail = v.ticket_number::text;
  end if;
  if p_expected_version is distinct from v.version then
    raise exception 'stale_ticket' using detail = v.ticket_number::text;
  end if;
  return v;
end;
$$;

-------------------------------------------------------------------------------
-- save_ticket: create a ticket (p_ticket_id null) or replace an open ticket's lines.
-- p_lines: [{"item_id": 12, "quantity": 2}, ...] in the order shown, 1 to 100 lines, one per item.
-- p_at is the time used for late pricing; the app always leaves it as now().
-- Errors: invalid_lines, empty_ticket, employee_not_found, employee_inactive, visit_not_found,
--         visit_closed, ticket_not_found, ticket_printed, ticket_cancelled, stale_ticket,
--         menu_item_not_found, item_unavailable
-------------------------------------------------------------------------------
create function public.save_ticket(
  p_visit_id          bigint,
  p_ticket_id         bigint,
  p_expected_version  integer,
  p_employee_id       bigint,
  p_lines             jsonb,
  p_time_zone         text,
  p_actor             uuid,
  p_at                timestamptz default now()
)
returns table (ticket_id bigint, ticket_number bigint, version integer)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket     public.tickets%rowtype;
  v_local      time;
  v_count      integer;
  v_bad        text;
  v_before     jsonb := '[]'::jsonb;
  v_after      jsonb;
  v_is_new     boolean := p_ticket_id is null;
begin
  -- Shape of the lines.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'empty_ticket';
  end if;
  if v_count > 100 or exists (
       select 1 from jsonb_array_elements(p_lines) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(jsonb_typeof(e -> 'item_id'), '') <> 'number'
           or coalesce(jsonb_typeof(e -> 'quantity'), '') <> 'number'
           or coalesce((e ->> 'item_id') !~ '^[0-9]{1,18}$', true)
           or case when (e ->> 'quantity') ~ '^[0-9]{1,2}$'
                   then (e ->> 'quantity')::integer not between 1 and 99
                   else true end)
     or (select count(distinct e ->> 'item_id') from jsonb_array_elements(p_lines) e) <> v_count then
    raise exception 'invalid_lines';
  end if;

  if p_time_zone is null or p_at is null then
    raise exception 'invalid_time';
  end if;
  v_local := (p_at at time zone p_time_zone)::time;  -- an unknown time zone is an error here

  perform public.require_active_employee(p_employee_id);
  perform public.lock_open_visit(p_visit_id);

  if not v_is_new then
    v_ticket := public.lock_open_ticket(p_ticket_id, p_visit_id, p_expected_version);
    select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]'::jsonb) into v_before
      from public.ticket_lines l where l.ticket_id = v_ticket.id;
  end if;

  -- Every item must exist; items not already on the ticket must be available.
  select e ->> 'item_id' into v_bad
    from jsonb_array_elements(p_lines) e
    left join public.menu_items mi on mi.id = (e ->> 'item_id')::bigint
   where mi.id is null
   limit 1;
  if v_bad is not null then
    raise exception 'menu_item_not_found' using detail = v_bad;
  end if;

  select mi.name into v_bad
    from jsonb_array_elements(p_lines) e
    join public.menu_items mi on mi.id = (e ->> 'item_id')::bigint
   where not mi.is_available
     and not exists (select 1 from jsonb_array_elements(v_before) b where (b ->> 'menu_item_id')::bigint = mi.id)
   limit 1;
  if v_bad is not null then
    raise exception 'item_unavailable' using detail = v_bad;
  end if;

  -- Every check has passed: only now take a ticket number, so refused saves leave no gaps.
  if v_is_new then
    insert into public.tickets (visit_id, employee_id, created_by)
    values (p_visit_id, p_employee_id, p_actor)
    returning * into v_ticket;
  end if;

  -- Replace the lines: kept items keep their copied name and price; new items are priced now.
  delete from public.ticket_lines l where l.ticket_id = v_ticket.id;

  insert into public.ticket_lines (ticket_id, line_no, menu_item_id, item_name, unit_price_cents,
                                   late_surcharge_cents, quantity, tax_category_code, tax_group_code, added_at)
  select v_ticket.id,
         i.ord,
         mi.id,
         coalesce(o.item_name, mi.name),
         coalesce(o.unit_price_cents, mi.price_cents + coalesce(late.amount, 0)),
         coalesce(o.late_surcharge_cents, coalesce(late.amount, 0)),
         i.quantity,
         coalesce(o.tax_category_code, mi.tax_category_code),
         coalesce(o.tax_group_code, tc.tax_group_code),
         coalesce(o.added_at, p_at)
    from (select (e ->> 'item_id')::bigint as item_id, (e ->> 'quantity')::smallint as quantity, ord::smallint as ord
            from jsonb_array_elements(p_lines) with ordinality as t (e, ord)) i
    join public.menu_items mi on mi.id = i.item_id
    join public.menu_categories mc on mc.id = mi.category_id
    join public.tax_categories tc on tc.code = mi.tax_category_code
    left join lateral (
      select mc.late_surcharge_cents as amount where mc.late_from is not null and v_local >= mc.late_from
    ) late on true
    left join jsonb_to_recordset(v_before) as o (menu_item_id bigint, item_name text, unit_price_cents integer,
                                                  late_surcharge_cents integer, tax_category_code text,
                                                  tax_group_code text, added_at timestamptz)
      on o.menu_item_id = mi.id;

  if not v_is_new then
    update public.tickets t
       set version = t.version + 1, last_edited_by_employee_id = p_employee_id
     where t.id = v_ticket.id
    returning * into v_ticket;
  end if;

  select jsonb_agg(jsonb_build_object('item', l.item_name, 'qty', l.quantity, 'price_cents', l.unit_price_cents) order by l.line_no)
    into v_after
    from public.ticket_lines l where l.ticket_id = v_ticket.id;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_saved', p_visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number,
    'employee', p_employee_id,
    'created', v_is_new,
    'before', (select coalesce(jsonb_agg(jsonb_build_object('item', b ->> 'item_name', 'qty', (b ->> 'quantity')::integer,
                                                            'price_cents', (b ->> 'unit_price_cents')::integer)), '[]'::jsonb)
                 from jsonb_array_elements(v_before) b),
    'after', v_after));

  return query select v_ticket.id, v_ticket.ticket_number, v_ticket.version;
end;
$$;

-------------------------------------------------------------------------------
-- cancel_ticket: an open (unprinted) ticket made by mistake. Kept in the history.
-- Errors: employee_not_found, employee_inactive, visit_not_found, visit_closed, ticket_not_found,
--         ticket_printed, ticket_cancelled, stale_ticket
-------------------------------------------------------------------------------
create function public.cancel_ticket(
  p_visit_id          bigint,
  p_ticket_id         bigint,
  p_expected_version  integer,
  p_employee_id       bigint,
  p_actor             uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_ticket public.tickets%rowtype;
begin
  perform public.require_active_employee(p_employee_id);
  perform public.lock_open_visit(p_visit_id);
  v_ticket := public.lock_open_ticket(p_ticket_id, p_visit_id, p_expected_version);

  update public.tickets t
     set status = 'cancelled', cancelled_at = now(), cancelled_by_employee_id = p_employee_id, version = t.version + 1
   where t.id = v_ticket.id;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_cancelled', p_visit_id,
          jsonb_build_object('ticket', v_ticket.ticket_number, 'employee', p_employee_id));
  return v_ticket.ticket_number;
end;
$$;

-------------------------------------------------------------------------------
-- Security: RLS on, no browser policies; functions for the server role only.
-------------------------------------------------------------------------------
alter table public.tickets enable row level security;
alter table public.ticket_lines enable row level security;

revoke all on table public.tickets, public.ticket_lines from anon, authenticated;
revoke all on sequence public.ticket_number_seq from anon, authenticated;
grant usage, select on sequence public.ticket_number_seq to service_role;

revoke execute on function
  public.require_active_employee(bigint),
  public.lock_open_visit(bigint),
  public.lock_open_ticket(bigint, bigint, integer),
  public.save_ticket(bigint, bigint, integer, bigint, jsonb, text, uuid, timestamptz),
  public.cancel_ticket(bigint, bigint, integer, bigint, uuid)
from public, anon, authenticated;

grant execute on function
  public.require_active_employee(bigint),
  public.lock_open_visit(bigint),
  public.lock_open_ticket(bigint, bigint, integer),
  public.save_ticket(bigint, bigint, integer, bigint, jsonb, text, uuid, timestamptz),
  public.cancel_ticket(bigint, bigint, integer, bigint, uuid)
to service_role;
