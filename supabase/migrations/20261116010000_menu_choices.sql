-- Menu changes (owner decisions, Nov 16, 2026). Saved tickets keep the names and prices they were saved with.
--  * Child's plates are named Kids Plate #1 to #10, with what is on the plate as the description.
--  * Items that come with beef or chicken ask which one: each choice is its own menu item under the item the
--    waiter taps, such as "Monterrey (Beef)", so the kitchen and the bill say which, and one table can have both.
--  * Soft drinks and extras are each a list of their own items, at $2.99 and $1.50.
--  * Mango (No Refills) joins the aguas frescas at $3.25.
--  * The side-order chimichanga is named "Chimichanga (Side order)".

-------------------------------------------------------------------------------
-- Choices, and items taken off the menu
-------------------------------------------------------------------------------
alter table public.menu_items
  add column parent_item_id bigint references public.menu_items (id),
  -- Off the menu for good: it stays only because saved tickets point to it.
  add column is_retired boolean not null default false,
  add constraint menu_items_not_own_choice check (parent_item_id is null or parent_item_id <> id),
  add constraint menu_items_retired_is_off check (not is_retired or not is_available);
create index menu_items_parent_idx on public.menu_items (parent_item_id) where parent_item_id is not null;

-- A choice has the price, availability, and tax of the item it belongs to, so a manager changes them in one place.
create function public.sync_menu_choices()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.menu_items c
     set price_cents = new.price_cents, is_available = new.is_available, tax_category_code = new.tax_category_code
   where c.parent_item_id = new.id and not c.is_retired
     and (c.price_cents, c.is_available, c.tax_category_code) is distinct from (new.price_cents, new.is_available, new.tax_category_code);
  return null;
end;
$$;
create trigger menu_items_sync_choices
  after update of price_cents, is_available, tax_category_code on public.menu_items
  for each row when (new.parent_item_id is null) execute function public.sync_menu_choices();
revoke execute on function public.sync_menu_choices() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Kids plates
-------------------------------------------------------------------------------
update public.menu_items i
   set name = 'Kids Plate #' || k.n,
       description = k.plate,
       name_es = 'Plato infantil #' || k.n
  from (select i2.id, m[1] as n, m[2] as plate
          from public.menu_items i2
          join public.menu_categories c on c.id = i2.category_id
          cross join lateral regexp_match(i2.name, '^([0-9]+)\.\s+(.+)$') m
         where c.code = 'childs-plates') k
 where i.id = k.id;

-------------------------------------------------------------------------------
-- The side-order chimichanga
-------------------------------------------------------------------------------
update public.menu_items i
   set name = 'Chimichanga (Side order)', name_es = 'Chimichanga (orden)'
  from public.menu_categories c
 where c.id = i.category_id and c.code = 'side-orders' and i.name = 'Chimichanga';

-------------------------------------------------------------------------------
-- Lists: soft drinks and extras. The old single items are retired (old tickets still point to them).
-------------------------------------------------------------------------------
update public.menu_items i
   set is_retired = true, is_available = false, sort_order = 200000 + i.id
  from public.menu_categories c
 where c.id = i.category_id
   and ((c.code = 'soft-drinks' and i.name = 'Soft drink') or (c.code = 'extras' and i.name = 'Extras (each)'));

insert into public.menu_items (category_id, name, name_es, description, price_cents, tax_category_code, sort_order)
select c.id, v.name, v.name_es, null, v.price_cents, v.tax_category_code,
       coalesce((select max(i.sort_order) from public.menu_items i where i.category_id = c.id and not i.is_retired), 0) + v.n
  from (values
    ('soft-drinks', 1, 'Coke', 'Coca-Cola', 299, 'nonalcoholic'),
    ('soft-drinks', 2, 'Coke Zero', 'Coca-Cola Zero', 299, 'nonalcoholic'),
    ('soft-drinks', 3, 'Diet Coke', 'Coca-Cola de dieta', 299, 'nonalcoholic'),
    ('soft-drinks', 4, 'Pibb', 'Pibb', 299, 'nonalcoholic'),
    ('soft-drinks', 5, 'Fanta (Orange)', 'Fanta (naranja)', 299, 'nonalcoholic'),
    ('soft-drinks', 6, 'Sprite', 'Sprite', 299, 'nonalcoholic'),
    ('soft-drinks', 7, 'Root Beer', 'Root Beer', 299, 'nonalcoholic'),
    ('soft-drinks', 8, 'Cream Soda', 'Cream Soda', 299, 'nonalcoholic'),
    ('soft-drinks', 9, 'Minute Maid Lemonade', 'Limonada Minute Maid', 299, 'nonalcoholic'),
    ('soft-drinks', 10, 'Raspberry Tea', 'Té de frambuesa', 299, 'nonalcoholic'),
    ('extras', 1, 'Sour cream', 'Crema agria', 150, 'food'),
    ('extras', 2, 'Grated cheese', 'Queso rallado', 150, 'food'),
    ('extras', 3, 'Tortillas', 'Tortillas', 150, 'food'),
    ('extras', 4, 'Jalapeños', 'Jalapeños', 150, 'food'),
    ('extras', 5, 'Pico de gallo', 'Pico de gallo', 150, 'food'),
    ('extras', 6, 'Hot sauce', 'Salsa picante', 150, 'food'),
    ('aguas-frescas', 1, 'Mango (No Refills)', 'Mango (sin rellenar)', 325, 'nonalcoholic')
  ) as v (category_code, n, name, name_es, price_cents, tax_category_code)
  join public.menu_categories c on c.code = v.category_code;

-------------------------------------------------------------------------------
-- Beef or chicken: two choices under each of these items
-------------------------------------------------------------------------------
insert into public.menu_items (category_id, parent_item_id, name, name_es, description, price_cents, tax_category_code,
                               is_available, sort_order)
select p.category_id, p.id, v.base || ' (' || ch.label || ')', v.base_es || ' (' || ch.label_es || ')', p.description,
       p.price_cents, p.tax_category_code, p.is_available, 100000 + p.sort_order * 10 + ch.n
  from (values
    ('fajitas', 'Beef or chicken fajitas', 'Beef or chicken fajitas', 'Fajitas de res o pollo'),
    ('favorites', 'Monterrey', 'Monterrey', 'Monterrey'),
    ('favorites', 'Chimichanga', 'Chimichanga', 'Chimichanga'),
    ('favorites', 'Quesadilla Grande', 'Quesadilla Grande', 'Quesadilla Grande'),
    ('favorites', 'Taquitos Mexicanos', 'Taquitos Mexicanos', 'Taquitos Mexicanos'),
    ('chicken-dishes', 'Taco salad (chicken or beef)', 'Taco salad', 'Ensalada de taco'),
    ('side-orders', 'Steak quesadilla (chicken or beef)', 'Steak quesadilla', 'Quesadilla de bistec'),
    ('side-orders', 'Chimichanga (Side order)', 'Chimichanga (Side order)', 'Chimichanga (orden)')
  ) as v (category_code, parent_name, base, base_es)
  join public.menu_categories c on c.code = v.category_code
  join public.menu_items p on p.category_id = c.id and p.name = v.parent_name
  cross join (values (1, 'Beef', 'Res'), (2, 'Chicken', 'Pollo')) as ch (n, label, label_es);

-------------------------------------------------------------------------------
-- save_table_order: as before, and an item with choices must be ordered as one of them.
-- Errors as before, plus choice_needed (detail: the item's name).
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

  -- What can't fit on one order is refused, never split off: 99 of an item, 100 items, and the note limits.
  if v_open.id is not null then
    if exists (select 1 from jsonb_array_elements(p_lines) e
                 join public.ticket_lines l on l.batch_id = v_open.id and l.menu_item_id = (e ->> 'item_id')::bigint
                where l.quantity + (e ->> 'quantity')::integer > 99
                   or char_length(concat_ws(' / ', l.notes, case when nullif(btrim(e ->> 'notes'), '') is distinct from l.notes
                                                                 then nullif(btrim(e ->> 'notes'), '') end)) > 200)
       or (select count(*) from public.ticket_lines l where l.batch_id = v_open.id)
          + (select count(*) from jsonb_array_elements(p_lines) e
              where not exists (select 1 from public.ticket_lines l where l.batch_id = v_open.id and l.menu_item_id = (e ->> 'item_id')::bigint)) > 100
       or char_length(concat_ws(' / ', v_open.notes, case when v_notes is distinct from v_open.notes then v_notes end)) > 500 then
      raise exception 'order_full' using detail = v_ticket.ticket_number::text;
    end if;
  end if;

  if v_open.id is not null then
    v_batch := v_open;
    -- An item already on it gets more quantity, at the price it was saved at; a different note is kept beside the first.
    update public.ticket_lines l
       set quantity = l.quantity + (e ->> 'quantity')::smallint,
           notes = case when nullif(btrim(e ->> 'notes'), '') is distinct from l.notes
                        then concat_ws(' / ', l.notes, nullif(btrim(e ->> 'notes'), '')) else l.notes end
      from jsonb_array_elements(p_lines) e
     where l.batch_id = v_batch.id and l.menu_item_id = (e ->> 'item_id')::bigint;

  -- New items go after the order's own; items already on it were added to above.
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
    ) late on true
   where mi.id is null or not exists (select 1 from public.ticket_lines l where l.batch_id = v_batch.id and l.menu_item_id = mi.id);

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
