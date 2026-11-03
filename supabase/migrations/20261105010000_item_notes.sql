-- A note on each item of an order, as well as the note on the whole order. It prints on the kitchen
-- receipt under its item, and never on the customer's bill. Existing lines simply have no note.

alter table public.ticket_lines
  add column notes text check (notes is null or char_length(notes) between 1 and 200);

-------------------------------------------------------------------------------
-- save_table_order: as before, and each line may carry "notes". Errors as before.
-------------------------------------------------------------------------------
create or replace function public.save_table_order(
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

  -- The restaurant is closed between shifts. Shared lock: a shift can't finish halfway through this save.
  perform 1 from public.shifts sh where sh.ended_at is null for share;
  if not found then
    raise exception 'restaurant_closed';
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
    if (v_e ? 'notes' and jsonb_typeof(v_e -> 'notes') not in ('string', 'null'))
       or char_length(btrim(v_e ->> 'notes')) > 200 then
      raise exception 'invalid_notes';
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
                                   late_surcharge_cents, quantity, tax_category_code, tax_group_code, added_at, notes)
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
         p_at,
         nullif(btrim(i.e ->> 'notes'), '')
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
                                                  'tax', l.tax_category_code, 'custom', l.is_custom, 'notes', l.notes) order by l.line_no)
                from public.ticket_lines l where l.batch_id = v_batch.id)));

  return query select v_ticket.id, v_ticket.ticket_number, v_ticket.version, v_batch.id, v_batch.batch_no, false;
end;
$$;

-------------------------------------------------------------------------------
-- change_ticket: as before, with one more change: {"op": "line_notes", "line_id": 5, "notes": "No onions"}
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

  select coalesce(jsonb_agg(jsonb_build_object('line', l.id, 'item', l.item_name, 'qty', l.quantity, 'notes', l.notes) order by l.batch_id, l.line_no), '[]'::jsonb)
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
      when 'line_notes' then
        if coalesce(jsonb_typeof(v_c -> 'line_id'), '') <> 'number' then
          raise exception 'invalid_changes';
        end if;
        v_notes := nullif(btrim(coalesce(v_c ->> 'notes', '')), '');
        if char_length(v_notes) > 200 then
          raise exception 'invalid_notes';
        end if;
        update public.ticket_lines l set notes = v_notes
         where l.id = (v_c ->> 'line_id')::bigint and l.ticket_id = v_ticket.id
        returning l.id into v_id;
        if v_id is null then
          raise exception 'line_not_found' using detail = v_c ->> 'line_id';
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
