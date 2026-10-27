-- Phase 9: printing tickets on the shared thermal printer (browser printing).
--
-- Rules (owner decisions, Oct 26-27, 2026):
-- * The ticket is saved before printing. Printing locks it for good ("print done = done");
--   a change after that means a new ticket.
-- * A ticket can be printed any number of times. Every print request is kept.
-- * The browser can't tell whether paper actually came out, so nothing claims it did: after each
--   print the waiter answers "Did it print?" and that answer is stored as the waiter's report.
-- * The printed ticket shows the waiter's number only.
-- * Printing never marks anything paid and never clears the table.
--
-- When a ticket is first printed its totals are frozen on the ticket, so a later tax-rate change
-- can never alter a printed ticket.

-------------------------------------------------------------------------------
-- Frozen totals on printed tickets
-------------------------------------------------------------------------------
alter table public.tickets
  add column food_subtotal_cents    bigint check (food_subtotal_cents >= 0),
  add column liquor_subtotal_cents  bigint check (liquor_subtotal_cents >= 0),
  add column food_rate_bp           integer check (food_rate_bp between 0 and 10000),
  add column liquor_rate_bp         integer check (liquor_rate_bp between 0 and 10000),
  add column food_tax_cents         bigint check (food_tax_cents >= 0),
  add column liquor_tax_cents       bigint check (liquor_tax_cents >= 0),
  add column total_cents            bigint check (total_cents >= 0),
  add column printed_by_employee_id bigint references public.employees (id);

alter table public.tickets add constraint tickets_printed_has_totals check (
  status <> 'printed' or (
    food_subtotal_cents is not null and liquor_subtotal_cents is not null
    and food_rate_bp is not null and liquor_rate_bp is not null
    and food_tax_cents is not null and liquor_tax_cents is not null
    and total_cents is not null and printed_by_employee_id is not null
    and total_cents = food_subtotal_cents + liquor_subtotal_cents + food_tax_cents + liquor_tax_cents));

create index tickets_printed_by_idx on public.tickets (printed_by_employee_id);

-- Printed tickets report their frozen totals; others are worked out at the current rates.
create or replace view public.ticket_totals
with (security_invoker = true)
as
with sums as (
  select t.id as ticket_id,
         t.ticket_number,
         t.visit_id,
         coalesce(sum(l.unit_price_cents::bigint * l.quantity) filter (where l.tax_group_code = 'food'), 0)::bigint   as food_subtotal_cents,
         coalesce(sum(l.unit_price_cents::bigint * l.quantity) filter (where l.tax_group_code = 'liquor'), 0)::bigint as liquor_subtotal_cents
    from public.tickets t
    left join public.ticket_lines l on l.ticket_id = t.id
   group by t.id
),
rates as (
  select max(rate_bp) filter (where code = 'food')   as food_rate_bp,
         max(rate_bp) filter (where code = 'liquor') as liquor_rate_bp
    from public.tax_groups
),
live as (
  select s.ticket_id,
         s.ticket_number,
         s.visit_id,
         s.food_subtotal_cents,
         s.liquor_subtotal_cents,
         r.food_rate_bp,
         r.liquor_rate_bp,
         public.tax_cents(s.food_subtotal_cents, r.food_rate_bp)     as food_tax_cents,
         public.tax_cents(s.liquor_subtotal_cents, r.liquor_rate_bp) as liquor_tax_cents
    from sums s
   cross join rates r
)
select l.ticket_id,
       l.ticket_number,
       l.visit_id,
       coalesce(t.food_subtotal_cents, l.food_subtotal_cents)     as food_subtotal_cents,
       coalesce(t.liquor_subtotal_cents, l.liquor_subtotal_cents) as liquor_subtotal_cents,
       coalesce(t.food_rate_bp, l.food_rate_bp)                   as food_rate_bp,
       coalesce(t.liquor_rate_bp, l.liquor_rate_bp)               as liquor_rate_bp,
       coalesce(t.food_tax_cents, l.food_tax_cents)               as food_tax_cents,
       coalesce(t.liquor_tax_cents, l.liquor_tax_cents)           as liquor_tax_cents,
       coalesce(t.total_cents,
                l.food_subtotal_cents + l.liquor_subtotal_cents + l.food_tax_cents + l.liquor_tax_cents) as total_cents
  from live l
  join public.tickets t on t.id = l.ticket_id;

-------------------------------------------------------------------------------
-- Print attempts
-------------------------------------------------------------------------------
create type public.print_kind as enum ('first', 'reprint');
create type public.print_outcome as enum ('unknown', 'printed', 'not_printed');

create table public.print_attempts (
  id              bigint generated always as identity primary key,
  ticket_id       bigint not null references public.tickets (id),
  attempt_no      integer not null check (attempt_no >= 1),
  kind            public.print_kind not null,
  employee_id     bigint not null references public.employees (id),
  requested_at    timestamptz not null default now(),
  requested_by    uuid references public.app_users (user_id) on delete set null,
  -- What the waiter answered to "Did it print?" ('unknown' until they answer). Not a printer signal.
  outcome         public.print_outcome not null default 'unknown',
  outcome_at      timestamptz,
  outcome_by_employee_id bigint references public.employees (id),
  constraint print_attempts_number unique (ticket_id, attempt_no),
  constraint print_attempts_first_is_one check ((kind = 'first') = (attempt_no = 1)),
  constraint print_attempts_outcome_time check ((outcome = 'unknown') = (outcome_at is null)),
  constraint print_attempts_outcome_by check ((outcome = 'unknown') = (outcome_by_employee_id is null))
);

create index print_attempts_employee_idx on public.print_attempts (employee_id);
create index print_attempts_requested_by_idx on public.print_attempts (requested_by);
create index print_attempts_outcome_by_idx on public.print_attempts (outcome_by_employee_id);

-------------------------------------------------------------------------------
-- Audit: printing events
-------------------------------------------------------------------------------
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed',
  'ticket_saved', 'ticket_cancelled',
  'ticket_printed', 'ticket_reprinted', 'print_outcome'
));

-------------------------------------------------------------------------------
-- print_ticket: first print. Locks the open ticket, freezes its totals, records attempt 1.
-- Returns the print attempt id.
-- Errors: employee_not_found, employee_inactive, visit_not_found, visit_closed, ticket_not_found,
--         ticket_printed, ticket_cancelled, stale_ticket, empty_ticket
-------------------------------------------------------------------------------
create function public.print_ticket(
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
  v_ticket   public.tickets%rowtype;
  v_totals   public.ticket_totals%rowtype;
  v_attempt  bigint;
begin
  perform public.require_active_employee(p_employee_id);
  perform public.lock_open_visit(p_visit_id);
  v_ticket := public.lock_open_ticket(p_ticket_id, p_visit_id, p_expected_version);

  if not exists (select 1 from public.ticket_lines l where l.ticket_id = v_ticket.id) then
    raise exception 'empty_ticket' using detail = v_ticket.ticket_number::text;
  end if;

  select * into v_totals from public.ticket_totals tt where tt.ticket_id = v_ticket.id;

  update public.tickets t
     set status = 'printed',
         printed_at = now(),
         printed_by_employee_id = p_employee_id,
         food_subtotal_cents = v_totals.food_subtotal_cents,
         liquor_subtotal_cents = v_totals.liquor_subtotal_cents,
         food_rate_bp = v_totals.food_rate_bp,
         liquor_rate_bp = v_totals.liquor_rate_bp,
         food_tax_cents = v_totals.food_tax_cents,
         liquor_tax_cents = v_totals.liquor_tax_cents,
         total_cents = v_totals.total_cents,
         version = t.version + 1
   where t.id = v_ticket.id;

  insert into public.print_attempts (ticket_id, attempt_no, kind, employee_id, requested_by)
  values (v_ticket.id, 1, 'first', p_employee_id, p_actor)
  returning id into v_attempt;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_printed', p_visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'attempt', 1, 'total_cents', v_totals.total_cents));
  return v_attempt;
end;
$$;

-------------------------------------------------------------------------------
-- reprint_ticket: print a printed ticket again (any number of times, even after the table is
-- cleared). Records the next attempt. Returns the print attempt id.
-- Errors: employee_not_found, employee_inactive, ticket_not_found, ticket_not_printed
-------------------------------------------------------------------------------
create function public.reprint_ticket(p_ticket_id bigint, p_employee_id bigint, p_actor uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_ticket   public.tickets%rowtype;
  v_next     integer;
  v_attempt  bigint;
begin
  perform public.require_active_employee(p_employee_id);

  -- Lock the ticket so two reprints at once get attempt numbers one after the other.
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_found' using detail = coalesce(p_ticket_id::text, '');
  end if;
  if v_ticket.status <> 'printed' then
    raise exception 'ticket_not_printed' using detail = v_ticket.ticket_number::text;
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next from public.print_attempts where ticket_id = v_ticket.id;

  insert into public.print_attempts (ticket_id, attempt_no, kind, employee_id, requested_by)
  values (v_ticket.id, v_next, 'reprint', p_employee_id, p_actor)
  returning id into v_attempt;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_reprinted', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'attempt', v_next));
  return v_attempt;
end;
$$;

-------------------------------------------------------------------------------
-- record_print_outcome: the waiter's answer to "Did it print?" for one attempt (once).
-- Errors: employee_not_found, employee_inactive, print_attempt_not_found, outcome_already_recorded
-------------------------------------------------------------------------------
create function public.record_print_outcome(p_attempt_id bigint, p_printed boolean, p_employee_id bigint, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.print_attempts%rowtype;
  v_ticket  public.tickets%rowtype;
begin
  perform public.require_active_employee(p_employee_id);

  select * into v_attempt from public.print_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'print_attempt_not_found' using detail = coalesce(p_attempt_id::text, '');
  end if;
  if v_attempt.outcome <> 'unknown' then
    raise exception 'outcome_already_recorded' using detail = v_attempt.attempt_no::text;
  end if;
  if p_printed is null then
    raise exception 'invalid_outcome';
  end if;

  update public.print_attempts
     set outcome = case when p_printed then 'printed'::public.print_outcome else 'not_printed'::public.print_outcome end,
         outcome_at = now(),
         outcome_by_employee_id = p_employee_id
   where id = v_attempt.id;

  select * into v_ticket from public.tickets where id = v_attempt.ticket_id;
  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'print_outcome', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'attempt', v_attempt.attempt_no, 'printed', p_printed, 'employee', p_employee_id));
end;
$$;

-------------------------------------------------------------------------------
-- Security: RLS on, no browser policies; functions for the server role only.
-------------------------------------------------------------------------------
alter table public.print_attempts enable row level security;
revoke all on table public.print_attempts from anon, authenticated;
revoke all on table public.ticket_totals from anon, authenticated;
grant select on table public.ticket_totals to service_role;

revoke execute on function
  public.print_ticket(bigint, bigint, integer, bigint, uuid),
  public.reprint_ticket(bigint, bigint, uuid),
  public.record_print_outcome(bigint, boolean, bigint, uuid)
from public, anon, authenticated;

grant execute on function
  public.print_ticket(bigint, bigint, integer, bigint, uuid),
  public.reprint_ticket(bigint, bigint, uuid),
  public.record_print_outcome(bigint, boolean, bigint, uuid)
to service_role;
