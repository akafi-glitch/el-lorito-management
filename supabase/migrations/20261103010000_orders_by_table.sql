-- Orders belong to a table, not to a seated group (owner decision, Nov 2, 2026).
--
-- The Waiter Section and the Floor are separate. A waiter picks a section, picks a table, and orders,
-- whether or not anyone is seated there and however many guests there are:
-- * A new ticket belongs to a table and has no visit. Seating, chips, and clearing never touch it.
-- * A table has at most one open ticket. Every order at that table goes on it until it is finished.
-- * When the waiter confirms the customer receipt printed, the ticket is finalized (as before) and the
--   table is free again: the next order starts a new ticket. Cancelling a ticket frees it too.
-- * Tickets stay linked to the visit they were made under, if any, for history and joined-table labels.
--
-- Existing data: no line, total, or timestamp changes. Each ticket gets the first table of its visit.
-- An open ticket whose group was already cleared stops being its table's current ticket; it keeps its
-- frozen totals and stays in the history as Open.
--
-- save_order (by visit) stays only so the previous app build keeps working until the new deployment is
-- live, and after a rollback. The new app does not call it. Remove it in a later migration.

-------------------------------------------------------------------------------
-- Tickets
-------------------------------------------------------------------------------
alter table public.tickets
  alter column visit_id drop not null,
  add column table_id uuid references public.restaurant_tables (id);

comment on column public.tickets.table_id is 'The table this ticket was ordered at. Tickets belong to tables; seating never changes them.';
comment on column public.tickets.visit_id is 'The seated group, only on tickets made before orders moved to tables. Null on new tickets.';
comment on column public.tickets.legacy_single_order is
  'True for old tickets that are not their table''s current ticket. They keep working the old way, through their visit.';

-- Backfill without touching updated_at or the lock: this describes old tickets, it doesn't change them.
alter table public.tickets disable trigger tickets_set_updated_at;
alter table public.tickets disable trigger tickets_locked_after_final;

update public.tickets t
   set table_id = (select vt.table_id
                     from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id
                    where vt.visit_id = t.visit_id
                    order by rt.sort_order, rt.id limit 1);

update public.tickets t
   set legacy_single_order = true
 where t.status = 'open'
   and not t.legacy_single_order
   and exists (select 1 from public.customer_visits v where v.id = t.visit_id and v.cleared_at is not null);

alter table public.tickets enable trigger tickets_locked_after_final;
alter table public.tickets enable trigger tickets_set_updated_at;

alter table public.tickets alter column table_id set not null;

-- Replaced by one open ticket per table: a table can have any number of finalized tickets now.
drop index public.tickets_one_active_per_visit;
drop index public.tickets_one_finalized_per_visit;
create unique index tickets_one_active_per_table on public.tickets (table_id) where status = 'open' and not legacy_single_order;
create index tickets_table_idx on public.tickets (table_id);

-- save_ticket (the previous build's function) still names only a visit.
create function public.fill_ticket_table()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.table_id is null and new.visit_id is not null then
    select vt.table_id into new.table_id
      from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id
     where vt.visit_id = new.visit_id
     order by rt.sort_order, rt.id limit 1;
  end if;
  return new;
end;
$$;

create trigger tickets_fill_table
  before insert on public.tickets
  for each row execute function public.fill_ticket_table();

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
  select * into v from public.tickets where id = p_ticket_id and visit_id is not distinct from p_visit_id for update;
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

-- Locks a ticket for a change. Only an old-style ticket still depends on its visit being open.
create function public.lock_order_ticket(p_ticket_id bigint, p_expected_version integer)
returns public.tickets
language plpgsql
set search_path = ''
as $$
declare
  v_visit  bigint;
  v_legacy boolean;
begin
  select t.visit_id, t.legacy_single_order into v_visit, v_legacy from public.tickets t where t.id = p_ticket_id;
  if not found then
    raise exception 'ticket_not_found' using detail = coalesce(p_ticket_id::text, '');
  end if;
  if v_legacy and v_visit is not null then
    perform public.lock_open_visit(v_visit);
  end if;
  return public.lock_open_ticket(p_ticket_id, v_visit, p_expected_version);
end;
$$;

-- What a ticket's receipts and history call its table: the visit's joined tables, else its own table.
create function public.ticket_table_labels(p_ticket_id bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select string_agg(rt.label, ' + ' order by regexp_replace(rt.label, '[0-9]+', '', 'g'),
                       nullif(regexp_replace(rt.label, '[^0-9]+', '', 'g'), '')::integer)
       from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id
      where vt.visit_id = t.visit_id),
    (select rt.label from public.restaurant_tables rt where rt.id = t.table_id))
  from public.tickets t
  where t.id = p_ticket_id
$$;

-------------------------------------------------------------------------------
-- save_table_order: adds one order to the table's open ticket, starting a ticket if it has none.
-- p_lines as before:
--   [{"item_id": 12, "quantity": 2},
--    {"name": "Extra guacamole", "price_cents": 300, "tax_category": "food", "quantity": 1}]
-- p_at is the time used for late pricing; the app always leaves it as now().
-- Saving the same p_client_key again returns the first result (already_saved) and adds nothing.
-- Errors: missing_client_key, invalid_lines, empty_ticket, invalid_custom_item, invalid_notes,
--         invalid_time, employee_not_found, employee_inactive, table_not_found, menu_item_not_found,
--         item_unavailable
-------------------------------------------------------------------------------
create function public.save_table_order(
  p_table_code  text,
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
  v_table   uuid;
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

  -- Fast path for a repeated press.
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

  -- Lock the table: saves at one table run one after the other, so it only ever has one open ticket.
  select rt.id into v_table from public.restaurant_tables rt where rt.code = p_table_code for no key update;
  if not found then
    raise exception 'table_not_found' using detail = coalesce(p_table_code, '');
  end if;

  -- The same key may have been saved while this call waited for the lock.
  select * into v_batch from public.ticket_batches b where b.client_key = p_client_key;
  if found then
    return query
      select t.id, t.ticket_number, t.version, v_batch.id, v_batch.batch_no, true
        from public.tickets t where t.id = v_batch.ticket_id;
    return;
  end if;

  select * into v_ticket from public.tickets t
   where t.table_id = v_table and t.status = 'open' and not t.legacy_single_order
   for update;
  if not found then
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
    insert into public.tickets (table_id, employee_id, created_by, shift_id)
    values (v_table, p_employee_id, p_actor, (select sh.id from public.shifts sh where sh.ended_at is null))
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
  values (p_actor, 'order_saved', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number,
    'table', p_table_code,
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

-------------------------------------------------------------------------------
-- change_ticket: as before, without needing anyone seated.
-------------------------------------------------------------------------------
create or replace function public.change_ticket(
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

  v_ticket := public.lock_order_ticket(p_ticket_id, p_expected_version);

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
  values (p_actor, 'ticket_changed', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'changes', p_changes, 'before', v_before));
  return v_ticket.version;
end;
$$;

-------------------------------------------------------------------------------
-- customer_receipt_snapshot: as before, with the ticket's table labels.
-------------------------------------------------------------------------------
create or replace function public.customer_receipt_snapshot(p_ticket_id bigint, p_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ticket_number', t.ticket_number,
    'waiter_number', e.employee_number,
    'tables', public.ticket_table_labels(t.id),
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
-- request_kitchen_print: as before, without needing anyone seated.
-------------------------------------------------------------------------------
create or replace function public.request_kitchen_print(
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
  v_legacy boolean;
  v_ids    bigint[];
  v_bad    bigint;
  v_id     bigint;
  v_next   integer;
begin
  perform public.require_active_employee(p_employee_id);

  select t.visit_id, t.legacy_single_order into v_visit, v_legacy from public.tickets t where t.id = p_ticket_id;
  if not found then
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

  -- Only an old-style ticket still depends on its visit. The visit first, then the ticket, as everywhere.
  if v_legacy and v_visit is not null then
    perform public.lock_open_visit(v_visit);
  end if;
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
-- cancel_order: cancels a table's open ticket. The table is then free for a new order.
-- Errors: ticket_not_found, employee_not_found, employee_inactive, ticket_finalized, ticket_printed,
--         ticket_cancelled, stale_ticket, visit_not_found, visit_closed
-------------------------------------------------------------------------------
create function public.cancel_order(
  p_ticket_id        bigint,
  p_expected_version integer,
  p_employee_id      bigint,
  p_actor            uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_ticket public.tickets%rowtype;
begin
  perform public.require_active_employee(p_employee_id);
  v_ticket := public.lock_order_ticket(p_ticket_id, p_expected_version);

  update public.tickets t
     set status = 'cancelled', cancelled_at = now(), cancelled_by_employee_id = p_employee_id, version = t.version + 1
   where t.id = v_ticket.id;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_cancelled', v_ticket.visit_id,
          jsonb_build_object('ticket', v_ticket.ticket_number, 'employee', p_employee_id));
  return v_ticket.ticket_number;
end;
$$;

-------------------------------------------------------------------------------
-- clear_visit: the Floor's clearing leaves current tickets alone. It still freezes old-style ones.
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
   where tt.ticket_id = t.id and t.visit_id = p_visit_id and t.status = 'open' and t.legacy_single_order;

  insert into public.audit_events (actor_id, event_type, visit_id) values (p_actor, 'cleared', p_visit_id);
  return v_version;
end;
$$;

-------------------------------------------------------------------------------
-- save_order: the previous app build's call, by visit (see the top of this file).
-------------------------------------------------------------------------------
create or replace function public.save_order(
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
  v_code  text;
  v_saved record;
begin
  select rt.code into v_code
    from public.visit_tables vt join public.restaurant_tables rt on rt.id = vt.table_id
   where vt.visit_id = p_visit_id
   order by rt.sort_order, rt.id limit 1;
  if v_code is null then
    raise exception 'visit_not_found' using detail = coalesce(p_visit_id::text, '');
  end if;

  -- A repeated press answers even after the table was cleared.
  if not exists (select 1 from public.ticket_batches b where b.client_key = p_client_key) then
    perform public.lock_open_visit_for_update(p_visit_id);
  end if;

  select * into v_saved from public.save_table_order(v_code, p_employee_id, p_client_key, p_lines, p_notes, p_time_zone, p_actor, p_at);

  -- That build finds its tickets through the visit.
  update public.tickets t set visit_id = p_visit_id
   where t.id = v_saved.ticket_id and t.visit_id is null and t.status = 'open';

  return query select v_saved.ticket_id, v_saved.ticket_number, v_saved.version, v_saved.batch_id, v_saved.batch_no, v_saved.already_saved;
end;
$$;

-------------------------------------------------------------------------------
-- History: the same columns; a ticket with no visit shows its own table.
-------------------------------------------------------------------------------
create or replace view public.ticket_history
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
       public.ticket_table_labels(t.id) as table_labels,
       tt.total_cents
  from public.tickets t
  join public.employees e on e.id = t.employee_id
  join public.ticket_totals tt on tt.ticket_id = t.id
  left join public.shifts sh on sh.id = t.shift_id;

-------------------------------------------------------------------------------
-- Security: functions for the server role only.
-------------------------------------------------------------------------------
revoke execute on function
  public.fill_ticket_table(),
  public.lock_order_ticket(bigint, integer),
  public.ticket_table_labels(bigint),
  public.save_table_order(text, bigint, uuid, jsonb, text, text, uuid, timestamptz),
  public.cancel_order(bigint, integer, bigint, uuid)
from public, anon, authenticated;

grant execute on function
  public.lock_order_ticket(bigint, integer),
  public.ticket_table_labels(bigint),
  public.save_table_order(text, bigint, uuid, jsonb, text, text, uuid, timestamptz),
  public.cancel_order(bigint, integer, bigint, uuid)
to service_role;
