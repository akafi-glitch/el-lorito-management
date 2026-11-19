-- Owner decisions, Nov 18, 2026:
--  * A Misc page with the 33 items of the owner's price list (PRECIOS), at its prices. Their names are Spanish, so
--    each is its own Spanish name. Michelada de Agua Mineral has no beer, so it is a nonalcoholic drink.
--  * The same item can be on one order more than once, each line with its own note: two chicken fajitas, one with
--    no tomato and one with no avocado. Tapping an item again adds a new line; + raises a line's quantity.
-- Saved tickets keep their lines, names, and prices.

-------------------------------------------------------------------------------
-- One order may have the same item on several lines.
-------------------------------------------------------------------------------
alter table public.ticket_lines drop constraint ticket_lines_one_line_per_item;
create index ticket_lines_batch_item_idx on public.ticket_lines (batch_id, menu_item_id);

-------------------------------------------------------------------------------
-- Misc
-------------------------------------------------------------------------------
insert into public.menu_categories (code, name, note, sort_order)
values ('misc', 'Misc', null, (select max(sort_order) + 1 from public.menu_categories));

insert into public.menu_items (category_id, name, name_es, price_cents, tax_category_code, sort_order)
select c.id, v.name, v.name, v.price_cents, v.tax_category_code, v.n
  from (values
    (1, 'Quesa Camaron Carta', 699, 'food'),
    (2, 'Pieza de CHT Tender', 235, 'food'),
    (3, 'CHT Tender Dinner 4 Piezas', 899, 'food'),
    (4, 'Chimi Camaron Carta', 775, 'food'),
    (5, 'Faja Quesadilla en A con Pollo', 299, 'food'),
    (6, 'Flauta Carta o Taquito Mexicano', 325, 'food'),
    (7, 'Carne Asada Carta', 899, 'food'),
    (8, 'Pieza de Steak', 899, 'food'),
    (9, 'Tilapia Carta', 699, 'food'),
    (10, 'Huevo Carta', 199, 'food'),
    (11, 'Hongos, Cebolla, Peppers Carta', 375, 'food'),
    (12, 'Cebolla, Peppers Carta', 250, 'food'),
    (13, 'Camaron Solo', 95, 'food'),
    (14, 'Chile Toreado', 65, 'food'),
    (15, 'Extra Guacamole', 150, 'food'),
    (16, 'Extra Cheese Dip', 150, 'food'),
    (17, 'Cebolla en Taco', 25, 'food'),
    (18, 'Cebolla en Enchilada', 25, 'food'),
    (19, 'Enchilada de Camaron', 425, 'food'),
    (20, 'Orden de Pollo Faja', 575, 'food'),
    (21, 'Orden de Carne Faja', 575, 'food'),
    (22, 'Orden de Aguacate', 499, 'food'),
    (23, 'Orden Chips de Harina', 300, 'food'),
    (24, 'Orden Papas Fritas', 375, 'food'),
    (25, 'Orden de Vegetales', 399, 'food'),
    (26, 'Orden de Carne Molida', 399, 'food'),
    (27, 'Orden de Pollo Desebrado', 399, 'food'),
    (28, 'Michelada de Agua Mineral', 425, 'nonalcoholic'),
    (29, 'Taco de Camaron', 425, 'food'),
    (30, 'Ensalada de Fajas', 699, 'food'),
    (31, 'Poblano con Cheese Dip', 300, 'food'),
    (32, 'Biste Ranchero con Cheese Dip', 300, 'food'),
    (33, 'Chile Colorado con Cheese Dip', 350, 'food')
  ) as v (n, name, price_cents, tax_category_code)
  join public.menu_categories c on c.code = 'misc';

-------------------------------------------------------------------------------
-- save_table_order: as before, but the same item may come more than once, and every saved item is a new line on
-- the order (never added to a line already there), so each keeps its own note. An order still holds up to 100 lines.
-- Errors as before; invalid_lines is no longer raised for the same item twice.
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
  v_open    public.ticket_batches%rowtype;
begin
  if p_client_key is null then
    raise exception 'missing_client_key';
  end if;

  -- Fast path for a repeated press, whether it started an order or added to one.
  select * into v_batch from public.ticket_batches b where b.client_key = p_client_key;
  if not found then
    select b.* into v_batch from public.order_save_keys k join public.ticket_batches b on b.id = k.batch_id
     where k.client_key = p_client_key;
  end if;
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
  if not found then
    select b.* into v_batch from public.order_save_keys k join public.ticket_batches b on b.id = k.batch_id
     where k.client_key = p_client_key;
  end if;
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

  -- An item with choices (Beef or Chicken) is ordered as one of its choices, never on its own.
  select mi.name into v_bad
    from jsonb_array_elements(p_lines) e
    join public.menu_items mi on mi.id = (e ->> 'item_id')::bigint
   where e ? 'item_id' and exists (select 1 from public.menu_items c where c.parent_item_id = mi.id and not c.is_retired)
   limit 1;
  if v_bad is not null then
    raise exception 'choice_needed' using detail = v_bad;
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

  -- Until its kitchen receipt prints, a table's order takes everything saved (owner decision, Nov 10, 2026): the
  -- table's latest order, while no kitchen receipt for it is printed or waiting for an answer. Never a new order.
  if not v_is_new then
    select * into v_open from public.ticket_batches b where b.ticket_id = v_ticket.id order by b.batch_no desc limit 1;
    if v_open.id is not null and (
         v_open.kitchen_printed_at is not null
      or exists (select 1 from public.print_attempts a where a.batch_id = v_open.id and a.outcome in ('unknown', 'printed'))
    ) then
      v_open := null;
    end if;
  end if;

  -- What can't fit on one order is refused, never split off: more than 100 lines, or the order note's limit.
  if v_open.id is not null then
    if (select count(*) from public.ticket_lines l where l.batch_id = v_open.id) + v_count > 100
       or char_length(concat_ws(' / ', v_open.notes, case when v_notes is distinct from v_open.notes then v_notes end)) > 500 then
      raise exception 'order_full' using detail = v_ticket.ticket_number::text;
    end if;
  end if;

  if v_open.id is not null then
    v_batch := v_open;

  -- Each item is a new line after the order's own, even an item already on it, so each keeps its own note.
  insert into public.ticket_lines (ticket_id, batch_id, line_no, menu_item_id, is_custom, item_name, unit_price_cents,
                                   late_surcharge_cents, quantity, tax_category_code, tax_group_code, added_at, notes)
  select v_ticket.id,
         v_batch.id,
         (select coalesce(max(l.line_no), 0) from public.ticket_lines l where l.batch_id = v_batch.id) + row_number() over (order by i.ord),
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

    if v_notes is not null and v_notes is distinct from v_batch.notes then
      update public.ticket_batches b set notes = concat_ws(' / ', b.notes, v_notes) where b.id = v_batch.id
      returning * into v_batch;
    end if;
    insert into public.order_save_keys (client_key, batch_id) values (p_client_key, v_batch.id);
  else
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
  end if;


  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'order_saved', v_ticket.visit_id, jsonb_build_object(
    'ticket', v_ticket.ticket_number,
    'table', p_table_code,
    'batch', v_batch.id,
    'batch_no', v_batch.batch_no,
    'employee', p_employee_id,
    'created', v_is_new,
    'added_to_order', v_open.id is not null,
    'notes', v_notes,
    'lines', (select jsonb_agg(jsonb_build_object('item', l.item_name, 'qty', l.quantity, 'price_cents', l.unit_price_cents,
                                                  'tax', l.tax_category_code, 'custom', l.is_custom, 'notes', l.notes) order by l.line_no)
                from public.ticket_lines l where l.batch_id = v_batch.id)));

  return query select v_ticket.id, v_ticket.ticket_number, v_ticket.version, v_batch.id, v_batch.batch_no, false;
end;
$$;
