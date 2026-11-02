-- One customer ticket per group, kitchen orders inside it, and finalizing the bill.
--
-- Rules (owner decisions, Nov 2, 2026):
-- * The ticket number identifies the customer's visit. More items never make a new ticket: each
--   submitted order is a batch (ticket_batches) on the same ticket, with its own ID and one note.
-- * Any waiter can add to any table's ticket. The ticket keeps the waiter who started it; each batch
--   keeps the waiter who took it. Two waiters adding at once get two batches; nothing is overwritten.
-- * Saving is safe to repeat: the screen sends one key per order, and the same key never saves twice.
-- * A custom item (name, price, quantity, explicit tax category) is a line with no menu item. It is
--   saved only on that ticket and never joins the menu.
-- * A kitchen receipt prints one batch, without prices. Printing it never locks the ticket.
-- * Before finalizing, lines can be changed or removed, and notes edited (version checked).
-- * The browser can't prove paper came out. Asking for the customer receipt only records an attempt
--   with the exact bill; the ticket is FINALIZED when the waiter confirms that attempt printed. If
--   the ticket changed after that receipt was made, the confirmation is refused. Refused, failed, and
--   unanswered attempts stay on record and change nothing.
-- * Finalized: totals frozen, the printed bill kept as final_receipt, and the database itself refuses
--   any change. The receipt can be reprinted; clearing the table is not affected.
-- * Clearing a table freezes the totals of any unfinalized ticket, so tax-rate changes can't alter
--   history. Such a ticket can still be billed and finalized, but no longer changed.
--
-- Existing data: every saved line goes into batch 1 of its ticket. Nothing already printed changes.
-- Old tickets are marked legacy_single_order (one visit could have several); the newest open one of a
-- group still seated becomes the group's active ticket.
--
-- save_ticket and print_ticket stay, working on this schema, only so the previous build of the app
-- keeps working between this migration and the new deployment (and after a rollback). The new app
-- does not call them; remove them in a later migration.

-------------------------------------------------------------------------------
-- Tickets
-------------------------------------------------------------------------------
alter table public.tickets
  add column shift_id                 bigint references public.shifts (id),
  add column legacy_single_order      boolean not null default true,
  add column finalized_at             timestamptz,
  add column finalized_by_employee_id bigint references public.employees (id),
  add column final_receipt            jsonb;

-- Existing rows are true (above); new tickets are the one-ticket-per-group kind.
alter table public.tickets alter column legacy_single_order set default false;

comment on column public.tickets.shift_id is 'The shift open when the ticket started. Null when none was open.';
comment on column public.tickets.legacy_single_order is
  'True for tickets made the old way (several per visit). They keep working but are not the visit''s active ticket.';
comment on column public.tickets.final_receipt is 'The exact customer bill that was printed and confirmed when the ticket was finalized.';

-- Backfill without touching updated_at: this describes old tickets, it doesn't change them.
alter table public.tickets disable trigger tickets_set_updated_at;

update public.tickets t
   set shift_id = (select sh.id from public.shifts sh
                    where sh.started_at <= t.created_at and (sh.ended_at is null or sh.ended_at > t.created_at)
                    order by sh.started_at desc limit 1);

update public.tickets t
   set legacy_single_order = false
 where t.status = 'open'
   and t.id = (select max(o.id) from public.tickets o where o.visit_id = t.visit_id and o.status = 'open')
   and exists (select 1 from public.customer_visits v where v.id = t.visit_id and v.cleared_at is null);

alter table public.tickets enable trigger tickets_set_updated_at;

alter table public.tickets
  add constraint tickets_finalized_time check ((status = 'finalized') = (finalized_at is not null)),
  add constraint tickets_finalized_complete check (
    status <> 'finalized' or (
      final_receipt is not null and finalized_by_employee_id is not null
      and food_subtotal_cents is not null and liquor_subtotal_cents is not null
      and food_rate_bp is not null and liquor_rate_bp is not null
      and food_tax_cents is not null and liquor_tax_cents is not null
      and total_cents is not null
      and total_cents = food_subtotal_cents + liquor_subtotal_cents + food_tax_cents + liquor_tax_cents));

-- THE one-ticket guard: at most one active ticket and one finalized ticket per visit.
create unique index tickets_one_active_per_visit on public.tickets (visit_id) where status = 'open' and not legacy_single_order;
create unique index tickets_one_finalized_per_visit on public.tickets (visit_id) where status = 'finalized';

create index tickets_shift_idx on public.tickets (shift_id);
create index tickets_finalized_by_idx on public.tickets (finalized_by_employee_id);
create index tickets_created_at_idx on public.tickets (created_at desc);

-------------------------------------------------------------------------------
-- Order batches
-------------------------------------------------------------------------------
create table public.ticket_batches (
  id                  bigint generated always as identity primary key,
  ticket_id           bigint not null references public.tickets (id),
  batch_no            integer not null check (batch_no >= 1),
  -- One key per order on the waiter's screen: the same key never saves twice.
  client_key          uuid unique,
  employee_id         bigint not null references public.employees (id),
  notes               text check (notes is null or char_length(notes) between 1 and 500),
  created_at          timestamptz not null default now(),
  created_by          uuid references public.app_users (user_id) on delete set null,
  -- Set when a waiter first confirms the kitchen receipt printed.
  kitchen_printed_at  timestamptz,
  constraint ticket_batches_number unique (ticket_id, batch_no),
  constraint ticket_batches_id_ticket unique (id, ticket_id)
);

comment on table public.ticket_batches is 'Each order submitted on a ticket. One kitchen receipt prints one batch.';

create index ticket_batches_employee_idx on public.ticket_batches (employee_id);
create index ticket_batches_created_by_idx on public.ticket_batches (created_by);

alter table public.ticket_batches enable row level security;
revoke all on table public.ticket_batches from anon, authenticated;
grant all on table public.ticket_batches to service_role;

insert into public.ticket_batches (ticket_id, batch_no, employee_id, created_at, created_by)
select id, 1, employee_id, created_at, created_by from public.tickets;

-------------------------------------------------------------------------------
-- Lines: each belongs to a batch; a custom item is a line with no menu item.
-------------------------------------------------------------------------------
alter table public.ticket_lines
  add column batch_id bigint,
  add column is_custom boolean not null default false,
  alter column menu_item_id drop not null,
  drop constraint ticket_lines_line_no,
  drop constraint ticket_lines_one_line_per_item;

update public.ticket_lines l
   set batch_id = b.id
  from public.ticket_batches b
 where b.ticket_id = l.ticket_id;

alter table public.ticket_lines
  alter column batch_id set not null,
  -- Both columns, so a line can never sit in another ticket's batch.
  add constraint ticket_lines_batch_fkey foreign key (batch_id, ticket_id) references public.ticket_batches (id, ticket_id),
  add constraint ticket_lines_batch_line_no unique (batch_id, line_no),
  add constraint ticket_lines_one_line_per_item unique (batch_id, menu_item_id),
  add constraint ticket_lines_custom_has_no_item check (is_custom = (menu_item_id is null));

create index ticket_lines_ticket_idx on public.ticket_lines (ticket_id);

-------------------------------------------------------------------------------
-- Print attempts: customer receipts and kitchen receipts
-------------------------------------------------------------------------------
create type public.receipt_kind as enum ('customer', 'kitchen');

alter table public.print_attempts
  add column receipt_kind     public.receipt_kind not null default 'customer',
  add column batch_id         bigint references public.ticket_batches (id),
  add column ticket_version   integer,
  add column receipt_snapshot jsonb,
  add column client_key       uuid,
  drop constraint print_attempts_number,
  add constraint print_attempts_kitchen_has_batch check ((receipt_kind = 'kitchen') = (batch_id is not null));

comment on column public.print_attempts.ticket_version is 'The ticket version this receipt showed; a confirmation for an older version is refused.';
comment on column public.print_attempts.receipt_snapshot is 'The exact customer receipt this attempt printed.';

create unique index print_attempts_customer_number on public.print_attempts (ticket_id, attempt_no) where receipt_kind = 'customer';
create unique index print_attempts_kitchen_number on public.print_attempts (batch_id, attempt_no) where receipt_kind = 'kitchen';
create unique index print_attempts_client_key on public.print_attempts (client_key, coalesce(batch_id, 0)) where client_key is not null;
create index print_attempts_ticket_idx on public.print_attempts (ticket_id);

-------------------------------------------------------------------------------
-- Database-level lock: no route around it, whatever calls the database.
-------------------------------------------------------------------------------
create function public.refuse_change_to_locked_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('finalized', 'printed') then
    raise exception 'ticket_finalized' using detail = old.ticket_number::text;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger tickets_locked_after_final
  before update or delete on public.tickets
  for each row execute function public.refuse_change_to_locked_ticket();

create function public.refuse_change_to_locked_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ticket_id bigint;
  v_number    bigint;
  v_status    public.ticket_status;
begin
  v_ticket_id := case when tg_op = 'DELETE' then old.ticket_id else new.ticket_id end;
  select t.ticket_number, t.status into v_number, v_status from public.tickets t where t.id = v_ticket_id for share;
  if v_status in ('finalized', 'printed', 'cancelled') then
    -- Recording that a kitchen receipt came out changes nothing on the bill, so it may arrive late.
    if tg_table_name = 'ticket_batches' and tg_op = 'UPDATE'
       and to_jsonb(new) - 'kitchen_printed_at' = to_jsonb(old) - 'kitchen_printed_at' then
      return new;
    end if;
    raise exception 'ticket_finalized' using detail = v_number::text;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger ticket_lines_locked_after_final
  before insert or update or delete on public.ticket_lines
  for each row execute function public.refuse_change_to_locked_order();

create trigger ticket_batches_locked_after_final
  before insert or update or delete on public.ticket_batches
  for each row execute function public.refuse_change_to_locked_order();

-------------------------------------------------------------------------------
-- Shared checks
-------------------------------------------------------------------------------
create or replace function public.lock_open_ticket(p_ticket_id bigint, p_visit_id bigint, p_expected_version integer)
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
  if v.status = 'finalized' then
    raise exception 'ticket_finalized' using detail = v.ticket_number::text;
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
-- save_order: adds one order to the group's ticket, starting the ticket if there is none yet.
-- p_lines, in the order shown, 1 to 100 lines:
--   [{"item_id": 12, "quantity": 2},
--    {"name": "Extra guacamole", "price_cents": 300, "tax_category": "food", "quantity": 1}]
-- p_at is the time used for late pricing; the app always leaves it as now().
-- Saving the same p_client_key again returns the first result (already_saved) and adds nothing.
-- Errors: missing_client_key, invalid_lines, empty_ticket, invalid_custom_item, invalid_notes,
--         invalid_time, employee_not_found, employee_inactive, visit_not_found, visit_closed,
--         ticket_finalized, menu_item_not_found, item_unavailable
-------------------------------------------------------------------------------
create function public.save_order(
  p_visit_id    bigint,
  p_employee_id bigint,
  p_client_key  uuid,
  p_lines       jsonb,
  p_notes       text,
  p_time_zone   text,
  p_actor       uuid,
  p_at          timestamptz default now()
)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket  public.tickets%rowtype;
  v_batch   public.ticket_batches%rowtype;
  v_local   time;
  v_count   integer;
  v_bad     text;
  v_notes   text := nullif(btrim(coalesce(p_notes, '')), '');
  v_e       jsonb;
  v_is_new  boolean := false;
begin
  if p_client_key is null then
    raise exception 'missing_client_key';
  end if;

  -- Fast path for a repeated press (also answers after the table was cleared).
  select * into v_batch from public.ticket_batches b where b.client_key = p_client_key;
  if found then
    return query
      select t.id, t.ticket_number, t.version, v_batch.id, v_batch.batch_no, true
        from public.tickets t where t.id = v_batch.ticket_id;
    return;
  end if;

  -- Shape of the lines.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'empty_ticket';
  end if;
  if v_count > 100 then
    raise exception 'invalid_lines';
  end if;
  for v_e in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_e) <> 'object'
       or coalesce(jsonb_typeof(v_e -> 'quantity'), '') <> 'number'
       or coalesce((v_e ->> 'quantity') !~ '^[0-9]{1,2}$', true)
       or (v_e ->> 'quantity')::integer not between 1 and 99 then
      raise exception 'invalid_lines';
    end if;
    if v_e ? 'item_id' then
      if coalesce(jsonb_typeof(v_e -> 'item_id'), '') <> 'number' or coalesce((v_e ->> 'item_id') !~ '^[0-9]{1,18}$', true) then
        raise exception 'invalid_lines';
      end if;
    elsif coalesce(jsonb_typeof(v_e -> 'name'), '') <> 'string'
       or char_length(btrim(v_e ->> 'name')) not between 1 and 80
       or coalesce(jsonb_typeof(v_e -> 'price_cents'), '') <> 'number'
       or coalesce((v_e ->> 'price_cents') !~ '^[0-9]{1,7}$', true)
       or (v_e ->> 'price_cents')::integer > 1000000
       or coalesce(jsonb_typeof(v_e -> 'tax_category'), '') <> 'string'
       or not exists (select 1 from public.tax_categories c where c.code = v_e ->> 'tax_category') then
      raise exception 'invalid_custom_item';
    end if;
  end loop;
  if (select count(e ->> 'item_id') from jsonb_array_elements(p_lines) e)
     <> (select count(distinct e ->> 'item_id') from jsonb_array_elements(p_lines) e) then
    raise exception 'invalid_lines';
  end if;
  if char_length(v_notes) > 500 then
    raise exception 'invalid_notes';
  end if;

  if p_time_zone is null or p_at is null then
    raise exception 'invalid_time';
  end if;
  v_local := (p_at at time zone p_time_zone)::time;  -- an unknown time zone is an error here

  perform public.require_active_employee(p_employee_id);

  -- Lock the visit: saves at one table run one after the other, and clearing waits for them.
  perform public.lock_open_visit_for_update(p_visit_id);

  -- The same key may have been saved while this call waited for the lock.
  select * into v_batch from public.ticket_batches b where b.client_key = p_client_key;
  if found then
    return query
      select t.id, t.ticket_number, t.version, v_batch.id, v_batch.batch_no, true
        from public.tickets t where t.id = v_batch.ticket_id;
    return;
  end if;

  select * into v_ticket from public.tickets t
   where t.visit_id = p_visit_id and t.status = 'open' and not t.legacy_single_order
   for update;
  if not found then
    select t.ticket_number::text into v_bad from public.tickets t where t.visit_id = p_visit_id and t.status = 'finalized';
    if v_bad is not null then
      raise exception 'ticket_finalized' using detail = v_bad;
    end if;
    v_is_new := true;
  end if;

  -- Every menu item must exist and be available.
  select e ->> 'item_id' into v_bad
    from jsonb_array_elements(p_lines) e
    left join public.menu_items mi on mi.id = (e ->> 'item_id')::bigint
   where e ? 'item_id' and mi.id is null
   limit 1;
  if v_bad is not null then
    raise exception 'menu_item_not_found' using detail = v_bad;
  end if;

  select mi.name into v_bad
    from jsonb_array_elements(p_lines) e
    join public.menu_items mi on mi.id = (e ->> 'item_id')::bigint
   where e ? 'item_id' and not mi.is_available
   limit 1;
  if v_bad is not null then
    raise exception 'item_unavailable' using detail = v_bad;
  end if;

  -- Every check has passed: only now take a ticket number, so refused saves leave no gaps.
  if v_is_new then
    insert into public.tickets (visit_id, employee_id, created_by, shift_id)
    values (p_visit_id, p_employee_id, p_actor, (select sh.id from public.shifts sh where sh.ended_at is null))
    returning * into v_ticket;
  else
    update public.tickets t
       set version = t.version + 1, last_edited_by_employee_id = p_employee_id
     where t.id = v_ticket.id
    returning * into v_ticket;
  end if;

  insert into public.ticket_batches (ticket_id, batch_no, client_key, employee_id, notes, created_at, created_by)
  select v_ticket.id, coalesce(max(b.batch_no), 0) + 1, p_client_key, p_employee_id, v_notes, p_at, p_actor
    from public.ticket_batches b where b.ticket_id = v_ticket.id
  returning * into v_batch;

  -- Menu items are priced now, from the menu; custom items carry what the waiter typed.
  insert into public.ticket_lines (ticket_id, batch_id, line_no, menu_item_id, is_custom, item_name, unit_price_cents,
                                   late_surcharge_cents, quantity, tax_category_code, tax_group_code, added_at)
  select v_ticket.id,
         v_batch.id,
         i.ord,
         mi.id,
         mi.id is null,
         coalesce(mi.name, btrim(i.e ->> 'name')),
         coalesce(mi.price_cents + coalesce(late.amount, 0), (i.e ->> 'price_cents')::integer),
         coalesce(late.amount, 0),
         (i.e ->> 'quantity')::smallint,
         tc.code,
         tc.tax_group_code,
         p_at
    from (select e, ord::smallint as ord from jsonb_array_elements(p_lines) with ordinality as t (e, ord)) i
    left join public.menu_items mi on mi.id = (i.e ->> 'item_id')::bigint
    left join public.menu_categories mc on mc.id = mi.category_id
    join public.tax_categories tc on tc.code = coalesce(mi.tax_category_code, i.e ->> 'tax_category')
    left join lateral (
      select mc.late_surcharge_cents as amount where mc.late_from is not null and v_local >= mc.late_from
    ) late on true;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'order_saved', p_visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number,
    'batch', v_batch.id,
    'batch_no', v_batch.batch_no,
    'employee', p_employee_id,
    'created', v_is_new,
    'notes', v_notes,
    'lines', (select jsonb_agg(jsonb_build_object('item', l.item_name, 'qty', l.quantity, 'price_cents', l.unit_price_cents,
                                                  'tax', l.tax_category_code, 'custom', l.is_custom) order by l.line_no)
                from public.ticket_lines l where l.batch_id = v_batch.id)));

  return query select v_ticket.id, v_ticket.ticket_number, v_ticket.version, v_batch.id, v_batch.batch_no, false;
end;
$$;

-- FOR UPDATE version of lock_open_visit: starting a ticket must wait for any other start.
create function public.lock_open_visit_for_update(p_visit_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_cleared timestamptz;
begin
  select cleared_at into v_cleared from public.customer_visits where id = p_visit_id for update;
  if not found then
    raise exception 'visit_not_found' using detail = coalesce(p_visit_id::text, '');
  end if;
  if v_cleared is not null then
    raise exception 'visit_closed' using detail = p_visit_id::text;
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- change_ticket: changes to what is saved, from the version the screen saw. Returns the new version.
-- p_changes, 1 to 100:
--   [{"op": "quantity", "line_id": 5, "quantity": 3}, {"op": "remove", "line_id": 6},
--    {"op": "notes", "batch_id": 2, "notes": "No onions"}]
-- Errors: invalid_changes, invalid_notes, line_not_found, batch_not_found, ticket_not_found,
--         employee_not_found, employee_inactive, visit_not_found, visit_closed, ticket_finalized,
--         ticket_printed, ticket_cancelled, stale_ticket
-------------------------------------------------------------------------------
create function public.change_ticket(
  p_ticket_id        bigint,
  p_expected_version integer,
  p_employee_id      bigint,
  p_changes          jsonb,
  p_actor            uuid
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_visit  bigint;
  v_ticket public.tickets%rowtype;
  v_c      jsonb;
  v_before jsonb;
  v_id     bigint;
  v_notes  text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) not between 1 and 100 then
    raise exception 'invalid_changes';
  end if;

  perform public.require_active_employee(p_employee_id);

  select visit_id into v_visit from public.tickets where id = p_ticket_id;
  if v_visit is null then
    raise exception 'ticket_not_found' using detail = coalesce(p_ticket_id::text, '');
  end if;
  perform public.lock_open_visit(v_visit);
  v_ticket := public.lock_open_ticket(p_ticket_id, v_visit, p_expected_version);

  select coalesce(jsonb_agg(jsonb_build_object('line', l.id, 'item', l.item_name, 'qty', l.quantity) order by l.batch_id, l.line_no), '[]'::jsonb)
    into v_before from public.ticket_lines l where l.ticket_id = v_ticket.id;

  for v_c in select c from jsonb_array_elements(p_changes) c loop
    case v_c ->> 'op'
      when 'quantity' then
        if coalesce(jsonb_typeof(v_c -> 'line_id'), '') <> 'number'
           or coalesce(jsonb_typeof(v_c -> 'quantity'), '') <> 'number'
           or coalesce((v_c ->> 'quantity') !~ '^[0-9]{1,2}$', true)
           or (v_c ->> 'quantity')::integer not between 1 and 99 then
          raise exception 'invalid_changes';
        end if;
        update public.ticket_lines l set quantity = (v_c ->> 'quantity')::smallint
         where l.id = (v_c ->> 'line_id')::bigint and l.ticket_id = v_ticket.id
        returning l.id into v_id;
        if v_id is null then
          raise exception 'line_not_found' using detail = v_c ->> 'line_id';
        end if;
      when 'remove' then
        if coalesce(jsonb_typeof(v_c -> 'line_id'), '') <> 'number' then
          raise exception 'invalid_changes';
        end if;
        delete from public.ticket_lines l
         where l.id = (v_c ->> 'line_id')::bigint and l.ticket_id = v_ticket.id
        returning l.id into v_id;
        if v_id is null then
          raise exception 'line_not_found' using detail = v_c ->> 'line_id';
        end if;
      when 'notes' then
        if coalesce(jsonb_typeof(v_c -> 'batch_id'), '') <> 'number' then
          raise exception 'invalid_changes';
        end if;
        v_notes := nullif(btrim(coalesce(v_c ->> 'notes', '')), '');
        if char_length(v_notes) > 500 then
          raise exception 'invalid_notes';
        end if;
        update public.ticket_batches b set notes = v_notes
         where b.id = (v_c ->> 'batch_id')::bigint and b.ticket_id = v_ticket.id
        returning b.id into v_id;
        if v_id is null then
          raise exception 'batch_not_found' using detail = v_c ->> 'batch_id';
        end if;
      else
        raise exception 'invalid_changes';
    end case;
    v_id := null;
  end loop;

  update public.tickets t
     set version = t.version + 1, last_edited_by_employee_id = p_employee_id
   where t.id = v_ticket.id
  returning * into v_ticket;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_changed', v_visit, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'changes', p_changes, 'before', v_before));
  return v_ticket.version;
end;
$$;

-------------------------------------------------------------------------------
-- customer_receipt_snapshot: the customer bill as stored data. All saved batches; the same item at
-- the same price is one line. A locked ticket reports its frozen totals (through ticket_totals).
-------------------------------------------------------------------------------
create function public.customer_receipt_snapshot(p_ticket_id bigint, p_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ticket_number', t.ticket_number,
    'waiter_number', e.employee_number,
    'tables', (select string_agg(rt.label, ' + ' order by regexp_replace(rt.label, '[0-9]+', '', 'g'),
                                 nullif(regexp_replace(rt.label, '[^0-9]+', '', 'g'), '')::integer)
                 from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id
                where vt.visit_id = t.visit_id),
    'printed_at', p_at,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                       'name', g.item_name, 'quantity', g.quantity, 'unit_cents', g.unit_price_cents,
                       'total_cents', g.unit_price_cents::bigint * g.quantity, 'tax_group', g.tax_group_code)
                     order by g.first_batch, g.first_line), '[]'::jsonb)
                from (select l.item_name, l.unit_price_cents, l.tax_group_code, sum(l.quantity)::integer as quantity,
                             min(b.batch_no) as first_batch, min(l.line_no) as first_line
                        from public.ticket_lines l join public.ticket_batches b on b.id = l.batch_id
                       where l.ticket_id = t.id
                       group by l.item_name, l.unit_price_cents, l.tax_group_code) g),
    'totals', jsonb_build_object(
      'food_subtotal_cents', tt.food_subtotal_cents,
      'liquor_subtotal_cents', tt.liquor_subtotal_cents,
      'food_rate_bp', tt.food_rate_bp,
      'liquor_rate_bp', tt.liquor_rate_bp,
      'food_tax_cents', tt.food_tax_cents,
      'liquor_tax_cents', tt.liquor_tax_cents,
      'total_cents', tt.total_cents))
  from public.tickets t
  join public.employees e on e.id = t.employee_id
  join public.ticket_totals tt on tt.ticket_id = t.id
  where t.id = p_ticket_id
$$;

-------------------------------------------------------------------------------
-- request_customer_receipt: records a print attempt and returns the bill to print. It never
-- finalizes. Open ticket: the bill as saved now, at the version the screen saw. Locked ticket: a copy
-- of the kept bill. The same p_client_key returns the same attempt.
-- Errors: empty_ticket, stale_ticket, ticket_not_found, ticket_cancelled, employee_not_found, employee_inactive
-------------------------------------------------------------------------------
create function public.request_customer_receipt(
  p_ticket_id        bigint,
  p_expected_version integer,
  p_employee_id      bigint,
  p_client_key       uuid,
  p_actor            uuid
)
returns table (attempt_id bigint, receipt jsonb, is_copy boolean)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket  public.tickets%rowtype;
  v_attempt public.print_attempts%rowtype;
  v_next    integer;
  v_receipt jsonb;
  v_copy    boolean;
begin
  perform public.require_active_employee(p_employee_id);

  select * into v_ticket from public.tickets t where t.id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_found' using detail = coalesce(p_ticket_id::text, '');
  end if;
  if v_ticket.status = 'cancelled' then
    raise exception 'ticket_cancelled' using detail = v_ticket.ticket_number::text;
  end if;
  v_copy := v_ticket.status <> 'open';

  if p_client_key is not null then
    select * into v_attempt from public.print_attempts a
     where a.client_key = p_client_key and a.ticket_id = v_ticket.id and a.receipt_kind = 'customer';
    if found then
      return query select v_attempt.id, v_attempt.receipt_snapshot, v_copy;
      return;
    end if;
  end if;

  if v_copy then
    v_receipt := coalesce(v_ticket.final_receipt,
                          public.customer_receipt_snapshot(v_ticket.id, v_ticket.printed_at));
  else
    if p_expected_version is distinct from v_ticket.version then
      raise exception 'stale_ticket' using detail = v_ticket.ticket_number::text;
    end if;
    if not exists (select 1 from public.ticket_lines l where l.ticket_id = v_ticket.id) then
      raise exception 'empty_ticket' using detail = v_ticket.ticket_number::text;
    end if;
    v_receipt := public.customer_receipt_snapshot(v_ticket.id, now());
  end if;

  select coalesce(max(a.attempt_no), 0) + 1 into v_next
    from public.print_attempts a where a.ticket_id = v_ticket.id and a.receipt_kind = 'customer';

  insert into public.print_attempts (ticket_id, attempt_no, kind, employee_id, requested_by, receipt_kind,
                                     ticket_version, receipt_snapshot, client_key)
  values (v_ticket.id, v_next,
          case when v_next = 1 then 'first'::public.print_kind else 'reprint'::public.print_kind end,
          p_employee_id, p_actor, 'customer', v_ticket.version, v_receipt, p_client_key)
  returning * into v_attempt;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, case when v_copy then 'ticket_reprinted' else 'customer_print_requested' end, v_ticket.visit_id,
          jsonb_build_object('ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'attempt', v_next,
                             'total_cents', v_receipt #>> '{totals,total_cents}'));

  return query select v_attempt.id, v_attempt.receipt_snapshot, v_copy;
end;
$$;

-------------------------------------------------------------------------------
-- record_print_outcome: the waiter's answer for one print attempt.
-- Yes to a customer receipt of an open ticket FINALIZES it, with that attempt's exact bill, in this
-- one transaction. The same answer again changes nothing (safe to repeat); a different one is refused.
-- Errors: employee_not_found, employee_inactive, print_attempt_not_found, outcome_already_recorded,
--         invalid_outcome, stale_ticket (the ticket changed after this receipt was made), ticket_cancelled
-------------------------------------------------------------------------------
create or replace function public.record_print_outcome(p_attempt_id bigint, p_printed boolean, p_employee_id bigint, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.print_attempts%rowtype;
  v_ticket  public.tickets%rowtype;
  v_totals  jsonb;
begin
  perform public.require_active_employee(p_employee_id);

  select * into v_attempt from public.print_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'print_attempt_not_found' using detail = coalesce(p_attempt_id::text, '');
  end if;
  if v_attempt.outcome <> 'unknown' then
    if p_printed is not null and (v_attempt.outcome = 'printed') = p_printed then
      return;
    end if;
    raise exception 'outcome_already_recorded' using detail = v_attempt.attempt_no::text;
  end if;
  if p_printed is null then
    raise exception 'invalid_outcome';
  end if;

  select * into v_ticket from public.tickets where id = v_attempt.ticket_id for update;

  if p_printed and v_attempt.receipt_kind = 'customer' and v_ticket.status = 'open' then
    if v_attempt.ticket_version is distinct from v_ticket.version then
      raise exception 'stale_ticket' using detail = v_ticket.ticket_number::text;
    end if;
    v_totals := v_attempt.receipt_snapshot -> 'totals';
    update public.tickets t
       set status = 'finalized',
           finalized_at = now(),
           finalized_by_employee_id = p_employee_id,
           final_receipt = v_attempt.receipt_snapshot,
           food_subtotal_cents = (v_totals ->> 'food_subtotal_cents')::bigint,
           liquor_subtotal_cents = (v_totals ->> 'liquor_subtotal_cents')::bigint,
           food_rate_bp = (v_totals ->> 'food_rate_bp')::integer,
           liquor_rate_bp = (v_totals ->> 'liquor_rate_bp')::integer,
           food_tax_cents = (v_totals ->> 'food_tax_cents')::bigint,
           liquor_tax_cents = (v_totals ->> 'liquor_tax_cents')::bigint,
           total_cents = (v_totals ->> 'total_cents')::bigint,
           version = t.version + 1
     where t.id = v_ticket.id;
    insert into public.audit_events (actor_id, event_type, visit_id, details)
    values (p_actor, 'ticket_finalized', v_ticket.visit_id, jsonb_build_object(
      'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'attempt', v_attempt.attempt_no,
      'total_cents', v_totals ->> 'total_cents'));
  elsif p_printed and v_attempt.receipt_kind = 'customer' and v_ticket.status = 'cancelled' then
    raise exception 'ticket_cancelled' using detail = v_ticket.ticket_number::text;
  end if;

  update public.print_attempts
     set outcome = case when p_printed then 'printed'::public.print_outcome else 'not_printed'::public.print_outcome end,
         outcome_at = now(),
         outcome_by_employee_id = p_employee_id
   where id = v_attempt.id;

  if p_printed and v_attempt.receipt_kind = 'kitchen' then
    update public.ticket_batches
       set kitchen_printed_at = now()
     where id = v_attempt.batch_id and kitchen_printed_at is null;
  end if;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'print_outcome', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'attempt', v_attempt.attempt_no, 'printed', p_printed, 'employee', p_employee_id,
    'receipt', v_attempt.receipt_kind, 'batch', v_attempt.batch_id));
end;
$$;

-------------------------------------------------------------------------------
-- request_kitchen_print: records one attempt per batch and returns them; the app then builds the
-- receipts. No batches named: every batch with items that hasn't printed yet (none confirmed, and none
-- still waiting for an answer). Never locks anything. The same p_client_key returns the same attempts.
-- Errors: nothing_to_print, batch_not_found, empty_batch, ticket_not_found, ticket_finalized,
--         ticket_printed, ticket_cancelled, visit_closed, employee_not_found, employee_inactive
-------------------------------------------------------------------------------
create function public.request_kitchen_print(
  p_ticket_id   bigint,
  p_batch_ids   bigint[],
  p_employee_id bigint,
  p_client_key  uuid,
  p_actor       uuid
)
returns table (attempt_id bigint, batch_id bigint, attempt_no integer, is_reprint boolean)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket public.tickets%rowtype;
  v_visit  bigint;
  v_ids    bigint[];
  v_bad    bigint;
  v_id     bigint;
  v_next   integer;
begin
  perform public.require_active_employee(p_employee_id);

  select t.visit_id into v_visit from public.tickets t where t.id = p_ticket_id;
  if v_visit is null then
    raise exception 'ticket_not_found' using detail = coalesce(p_ticket_id::text, '');
  end if;

  if p_client_key is not null and exists (select 1 from public.print_attempts a where a.client_key = p_client_key and a.ticket_id = p_ticket_id) then
    return query
      select a.id, a.batch_id, a.attempt_no, a.kind = 'reprint'
        from public.print_attempts a
       where a.client_key = p_client_key and a.ticket_id = p_ticket_id
       order by a.id;
    return;
  end if;

  -- The visit first, then the ticket: the same order as saving, so the two can't deadlock.
  perform public.lock_open_visit(v_visit);
  select * into v_ticket from public.tickets t where t.id = p_ticket_id for update;

  if v_ticket.status = 'finalized' then
    raise exception 'ticket_finalized' using detail = v_ticket.ticket_number::text;
  elsif v_ticket.status = 'printed' then
    raise exception 'ticket_printed' using detail = v_ticket.ticket_number::text;
  elsif v_ticket.status = 'cancelled' then
    raise exception 'ticket_cancelled' using detail = v_ticket.ticket_number::text;
  end if;

  if p_batch_ids is null or cardinality(p_batch_ids) = 0 then
    select array_agg(b.id order by b.batch_no) into v_ids
      from public.ticket_batches b
     where b.ticket_id = v_ticket.id
       and b.kitchen_printed_at is null
       and exists (select 1 from public.ticket_lines l where l.batch_id = b.id)
       and not exists (select 1 from public.print_attempts a where a.batch_id = b.id and a.outcome = 'unknown');
    if v_ids is null then
      raise exception 'nothing_to_print' using detail = v_ticket.ticket_number::text;
    end if;
  else
    select i into v_bad from unnest(p_batch_ids) i
     where not exists (select 1 from public.ticket_batches b where b.id = i and b.ticket_id = v_ticket.id)
     limit 1;
    if v_bad is not null then
      raise exception 'batch_not_found' using detail = v_bad::text;
    end if;
    select i into v_bad from unnest(p_batch_ids) i
     where not exists (select 1 from public.ticket_lines l where l.batch_id = i)
     limit 1;
    if v_bad is not null then
      raise exception 'empty_batch' using detail = v_bad::text;
    end if;
    select array_agg(distinct i) into v_ids from unnest(p_batch_ids) i;
  end if;

  foreach v_id in array v_ids loop
    select coalesce(max(a.attempt_no), 0) + 1 into v_next
      from public.print_attempts a where a.batch_id = v_id and a.receipt_kind = 'kitchen';
    insert into public.print_attempts (ticket_id, attempt_no, kind, employee_id, requested_by, receipt_kind,
                                       batch_id, ticket_version, client_key)
    values (v_ticket.id, v_next,
            case when v_next = 1 then 'first'::public.print_kind else 'reprint'::public.print_kind end,
            p_employee_id, p_actor, 'kitchen', v_id, v_ticket.version, p_client_key);
  end loop;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'kitchen_print_requested', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'batches', to_jsonb(v_ids)));

  return query
    select a.id, a.batch_id, a.attempt_no, a.kind = 'reprint'
      from public.print_attempts a
     where a.ticket_id = v_ticket.id and a.receipt_kind = 'kitchen' and a.batch_id = any (v_ids)
       and a.id in (select max(x.id) from public.print_attempts x where x.batch_id = any (v_ids) group by x.batch_id)
     order by a.id;
end;
$$;

-------------------------------------------------------------------------------
-- clear_visit: as before, and it freezes the totals of tickets left unfinalized.
-------------------------------------------------------------------------------
create or replace function public.clear_visit(p_visit_id bigint, p_expected_version integer, p_actor uuid)
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

  update public.tickets t
     set food_subtotal_cents = tt.food_subtotal_cents,
         liquor_subtotal_cents = tt.liquor_subtotal_cents,
         food_rate_bp = tt.food_rate_bp,
         liquor_rate_bp = tt.liquor_rate_bp,
         food_tax_cents = tt.food_tax_cents,
         liquor_tax_cents = tt.liquor_tax_cents,
         total_cents = tt.total_cents
    from public.ticket_totals tt
   where tt.ticket_id = t.id and t.visit_id = p_visit_id and t.status = 'open';

  insert into public.audit_events (actor_id, event_type, visit_id) values (p_actor, 'cleared', p_visit_id);
  return v_version;
end;
$$;

-------------------------------------------------------------------------------
-- The previous app build's functions, kept working on this schema (see the top of this file).
-------------------------------------------------------------------------------
create or replace function public.save_ticket(
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
  v_batch      bigint;
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
    -- A ticket using the new features can't be rewritten as one list without losing them.
    if exists (select 1 from public.ticket_lines l where l.ticket_id = v_ticket.id and l.is_custom)
       or (select count(*) from public.ticket_batches b where b.ticket_id = v_ticket.id) > 1 then
      raise exception 'ticket_uses_batches' using detail = v_ticket.ticket_number::text;
    end if;
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
    insert into public.tickets (visit_id, employee_id, created_by, shift_id, legacy_single_order)
    values (p_visit_id, p_employee_id, p_actor, (select sh.id from public.shifts sh where sh.ended_at is null), true)
    returning * into v_ticket;
    insert into public.ticket_batches (ticket_id, batch_no, employee_id, created_by)
    values (v_ticket.id, 1, p_employee_id, p_actor)
    returning id into v_batch;
  else
    select b.id into v_batch from public.ticket_batches b where b.ticket_id = v_ticket.id;
  end if;

  -- Replace the lines: kept items keep their copied name and price; new items are priced now.
  delete from public.ticket_lines l where l.ticket_id = v_ticket.id;

  insert into public.ticket_lines (ticket_id, batch_id, line_no, menu_item_id, item_name, unit_price_cents,
                                   late_surcharge_cents, quantity, tax_category_code, tax_group_code, added_at)
  select v_ticket.id,
         v_batch,
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

create or replace function public.print_ticket(
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
  v_next     integer;
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

  select coalesce(max(a.attempt_no), 0) + 1 into v_next
    from public.print_attempts a where a.ticket_id = v_ticket.id and a.receipt_kind = 'customer';

  insert into public.print_attempts (ticket_id, attempt_no, kind, employee_id, requested_by)
  values (v_ticket.id, v_next,
          case when v_next = 1 then 'first'::public.print_kind else 'reprint'::public.print_kind end,
          p_employee_id, p_actor)
  returning id into v_attempt;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_printed', p_visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'attempt', v_next, 'total_cents', v_totals.total_cents));
  return v_attempt;
end;
$$;

create or replace function public.reprint_ticket(p_ticket_id bigint, p_employee_id bigint, p_actor uuid)
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
  if v_ticket.status not in ('printed', 'finalized') then
    raise exception 'ticket_not_printed' using detail = v_ticket.ticket_number::text;
  end if;

  select coalesce(max(a.attempt_no), 0) + 1 into v_next
    from public.print_attempts a where a.ticket_id = v_ticket.id and a.receipt_kind = 'customer';

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
-- Order history: one row per ticket for Management. Totals come from the ticket's own saved lines
-- and frozen totals, never from current menu prices.
-------------------------------------------------------------------------------
create view public.ticket_history
with (security_invoker = true)
as
select t.id as ticket_id,
       t.ticket_number,
       t.created_at,
       t.status,
       t.visit_id,
       t.shift_id,
       sh.started_at as shift_started_at,
       t.employee_id,
       e.employee_number,
       (select string_agg(rt.label, ' + ' order by regexp_replace(rt.label, '[0-9]+', '', 'g'),
                          nullif(regexp_replace(rt.label, '[^0-9]+', '', 'g'), '')::integer)
          from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id
         where vt.visit_id = t.visit_id) as table_labels,
       tt.total_cents
  from public.tickets t
  join public.employees e on e.id = t.employee_id
  join public.ticket_totals tt on tt.ticket_id = t.id
  left join public.shifts sh on sh.id = t.shift_id;

-------------------------------------------------------------------------------
-- Live updates: a new order or a print attempt reaches the other devices.
-------------------------------------------------------------------------------
create trigger sync_ticket_batches after insert or update or delete on public.ticket_batches
  for each statement execute function public.note_change('tickets');
create trigger sync_print_attempts after insert or update or delete on public.print_attempts
  for each statement execute function public.note_change('tickets');

-------------------------------------------------------------------------------
-- Security: functions and the view for the server role only.
-------------------------------------------------------------------------------
revoke all on table public.ticket_history from anon, authenticated;
grant select on table public.ticket_history to service_role;

revoke execute on function
  public.refuse_change_to_locked_ticket(),
  public.refuse_change_to_locked_order(),
  public.lock_open_visit_for_update(bigint),
  public.save_order(bigint, bigint, uuid, jsonb, text, text, uuid, timestamptz),
  public.change_ticket(bigint, integer, bigint, jsonb, uuid),
  public.customer_receipt_snapshot(bigint, timestamptz),
  public.request_customer_receipt(bigint, integer, bigint, uuid, uuid),
  public.request_kitchen_print(bigint, bigint[], bigint, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.lock_open_visit_for_update(bigint),
  public.save_order(bigint, bigint, uuid, jsonb, text, text, uuid, timestamptz),
  public.change_ticket(bigint, integer, bigint, jsonb, uuid),
  public.customer_receipt_snapshot(bigint, timestamptz),
  public.request_customer_receipt(bigint, integer, bigint, uuid, uuid),
  public.request_kitchen_print(bigint, bigint[], bigint, uuid, uuid)
to service_role;
