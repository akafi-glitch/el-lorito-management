-- The manager edits the menu (owner decisions, Nov 17, 2026): add items, change their name, description, price, and
-- tax, add or remove options (such as Beef or Chicken) that waiters choose from, and take items off the menu.
-- Also: Taco salad fajita asks beef or chicken, and every beer is its own item with its price.
-- Saved tickets keep the names and prices they were saved with; nothing is deleted.

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'chips_undone', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'shift_finished', 'rotation_changed', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed', 'sections_remapped',
  'ticket_saved', 'ticket_cancelled', 'ticket_changed', 'order_saved',
  'ticket_printed', 'ticket_reprinted', 'print_outcome',
  'kitchen_print_requested', 'customer_print_requested', 'ticket_finalized',
  'pin_login', 'pin_failed', 'pin_lockout', 'pin_locked', 'pin_set', 'pin_disabled', 'pin_approved',
  'menu_item_added', 'menu_item_removed', 'menu_option_added'
));

-------------------------------------------------------------------------------
-- An option's own label ("Beef"), so renaming the item renames its options.
-------------------------------------------------------------------------------
alter table public.menu_items
  add column choice_label text check (choice_label is null or char_length(btrim(choice_label)) between 1 and 40);
update public.menu_items
   set choice_label = substring(name from '\(([^()]+)\)\s*$')
 where parent_item_id is not null;
alter table public.menu_items
  add constraint menu_items_option_has_label check ((parent_item_id is null) = (choice_label is null));

-- "Taco salad (chicken or beef)" -> "Taco salad": what goes before an option's label.
create function public.menu_option_base(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(p_name, '\s*\((chicken or beef|beef or chicken)\)\s*$', '', 'i'))
$$;

-------------------------------------------------------------------------------
-- Taco salad fajita: beef or chicken
-------------------------------------------------------------------------------
insert into public.menu_items (category_id, parent_item_id, choice_label, name, name_es, description, price_cents,
                               tax_category_code, is_available, sort_order)
select p.category_id, p.id, ch.label, 'Taco salad fajita (' || ch.label || ')', 'Ensalada de taco con fajita (' || ch.label_es || ')',
       p.description, p.price_cents, p.tax_category_code, p.is_available, 100000 + p.sort_order * 10 + ch.n
  from public.menu_items p
  join public.menu_categories c on c.id = p.category_id
 cross join (values (1, 'Beef', 'Res'), (2, 'Chicken', 'Pollo')) as ch (n, label, label_es)
 where c.code = 'chicken-dishes' and p.name = 'Taco salad fajita (beef or chicken)';

-------------------------------------------------------------------------------
-- Beer: each bottle its own item; each draft asks which beer
-------------------------------------------------------------------------------
update public.menu_items i
   set is_retired = true, is_available = false, sort_order = 200000 + i.id
  from public.menu_categories c
 where c.id = i.category_id and c.code = 'beer' and i.name in ('Domestic beer', 'Import beer') and i.parent_item_id is null;

-- Make room at the top of the page for the bottles.
update public.menu_items i
   set sort_order = i.sort_order + 100
  from public.menu_categories c
 where c.id = i.category_id and c.code = 'beer' and not i.is_retired and i.parent_item_id is null and i.sort_order < 100;

insert into public.menu_items (category_id, name, name_es, price_cents, tax_category_code, sort_order)
select c.id, v.name, v.name, v.price_cents, 'beer', v.n
  from (values
    (1, 'Bud Light', 499), (2, 'Budweiser', 499), (3, 'Miller Light', 499), (4, 'Coors Light', 499), (5, 'Michelob Ultra', 499),
    (6, 'Blue Moon', 525), (7, 'Corona', 525), (8, 'Modelo Especial', 525), (9, 'Negra Modelo', 525), (10, 'Sol', 525),
    (11, 'Pacifico', 525), (12, 'XX Lager', 525), (13, 'Tecate', 525), (14, 'XX Amber', 525), (15, 'Carta Blanca', 525)
  ) as v (n, name, price_cents)
  join public.menu_categories c on c.code = 'beer';

insert into public.menu_items (category_id, parent_item_id, choice_label, name, name_es, description, price_cents,
                               tax_category_code, is_available, sort_order)
select p.category_id, p.id, b.label, p.name || ' (' || b.label || ')', p.name_es || ' (' || b.label || ')', p.description,
       p.price_cents, p.tax_category_code, p.is_available, 100000 + p.sort_order * 10 + b.n
  from public.menu_items p
  join public.menu_categories c on c.id = p.category_id
  join (values
    ('Draft beer - 12 oz', 1, 'Bud Light'), ('Draft beer - 12 oz', 2, 'Budweiser'), ('Draft beer - 12 oz', 3, 'Michelob Ultra'),
    ('Draft beer - 12 oz', 4, 'Coors Light'), ('Draft beer - 12 oz', 5, 'Miller Light'),
    ('Draft beer - 32 oz', 1, 'Bud Light'), ('Draft beer - 32 oz', 2, 'Budweiser'), ('Draft beer - 32 oz', 3, 'Michelob Ultra'),
    ('Draft beer - 32 oz', 4, 'Coors Light'), ('Draft beer - 32 oz', 5, 'Miller Light'),
    ('Import draft beer - 12 oz', 1, 'XX Amber'), ('Import draft beer - 12 oz', 2, 'XX Lager'), ('Import draft beer - 12 oz', 3, 'Negra Modelo'),
    ('Import draft beer - 12 oz', 4, 'Pacifico'), ('Import draft beer - 12 oz', 5, 'Modelo Especial'),
    ('Import draft beer - 32 oz', 1, 'XX Amber'), ('Import draft beer - 32 oz', 2, 'XX Lager'), ('Import draft beer - 32 oz', 3, 'Negra Modelo'),
    ('Import draft beer - 32 oz', 4, 'Pacifico'), ('Import draft beer - 32 oz', 5, 'Modelo Especial')
  ) as b (parent_name, n, label) on b.parent_name = p.name
 where c.code = 'beer' and p.parent_item_id is null and not p.is_retired;

-------------------------------------------------------------------------------
-- add_menu_item: a new item on a menu page, at the end of the page. Returns its id.
-- Errors: category_not_found, invalid_name, invalid_description, invalid_tax_category, name_taken; a price outside
-- $0 to $10,000 is refused by the table (23514).
-------------------------------------------------------------------------------
create function public.add_menu_item(
  p_category_id  bigint,
  p_name         text,
  p_description  text,
  p_price_cents  integer,
  p_tax_category text,
  p_actor        uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_name        text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id          bigint;
begin
  perform 1 from public.menu_categories c where c.id = p_category_id for update; -- one new item at a time per page
  if not found then
    raise exception 'category_not_found' using detail = coalesce(p_category_id::text, '');
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_description) > 400 then
    raise exception 'invalid_description';
  end if;
  if not exists (select 1 from public.tax_categories t where t.code = p_tax_category) then
    raise exception 'invalid_tax_category' using detail = coalesce(p_tax_category, '');
  end if;
  if exists (select 1 from public.menu_items i where i.category_id = p_category_id and lower(i.name) = lower(v_name)) then
    raise exception 'name_taken' using detail = v_name;
  end if;

  insert into public.menu_items (category_id, name, description, price_cents, tax_category_code, sort_order)
  values (p_category_id, v_name, v_description, p_price_cents, p_tax_category,
          coalesce((select max(i.sort_order) from public.menu_items i where i.category_id = p_category_id and i.sort_order < 100000), 0) + 1)
  returning id into v_id;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_item_added', jsonb_build_object('item', v_id, 'name', v_name, 'category', p_category_id,
          'price_cents', p_price_cents, 'tax', p_tax_category));
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- update_menu_item_details: name, description, price, tax, and on/off of an item (not of one of its options).
-- Its options follow: the same price, tax, on/off, and description, and the new name before their label.
-- Returns the item's new name. Errors: menu_item_not_found, invalid_name, invalid_description, invalid_tax_category,
-- name_taken, and 23514 for a price outside $0 to $10,000.
-------------------------------------------------------------------------------
create function public.update_menu_item_details(
  p_item_id      bigint,
  p_name         text,
  p_description  text,
  p_price_cents  integer,
  p_tax_category text,
  p_is_available boolean,
  p_actor        uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_before      public.menu_items%rowtype;
  v_name        text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into v_before from public.menu_items where id = p_item_id for update;
  if not found or v_before.is_retired or v_before.parent_item_id is not null then
    raise exception 'menu_item_not_found' using detail = coalesce(p_item_id::text, '');
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_description) > 400 then
    raise exception 'invalid_description';
  end if;
  if not exists (select 1 from public.tax_categories t where t.code = p_tax_category) then
    raise exception 'invalid_tax_category' using detail = coalesce(p_tax_category, '');
  end if;
  if exists (select 1 from public.menu_items i
              where i.category_id = v_before.category_id and i.id <> p_item_id and lower(i.name) = lower(v_name)) then
    raise exception 'name_taken' using detail = v_name;
  end if;
  if exists (select 1 from public.menu_items c
              where c.parent_item_id = p_item_id and not c.is_retired
                and char_length(public.menu_option_base(v_name) || ' (' || c.choice_label || ')') > 80) then
    raise exception 'invalid_name';
  end if;

  update public.menu_items
     set name = v_name, description = v_description, price_cents = p_price_cents,
         tax_category_code = p_tax_category, is_available = coalesce(p_is_available, v_before.is_available)
   where id = p_item_id;

  -- The options: the trigger copies price, tax, and on/off; the name and description are copied here.
  if v_name is distinct from v_before.name or v_description is distinct from v_before.description then
    update public.menu_items c
       set name = public.menu_option_base(v_name) || ' (' || c.choice_label || ')', description = v_description
     where c.parent_item_id = p_item_id and not c.is_retired;
  end if;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_item_changed', jsonb_build_object(
    'item', p_item_id,
    'name', jsonb_build_object('from', v_before.name, 'to', v_name),
    'description', jsonb_build_object('from', v_before.description, 'to', v_description),
    'price_cents', jsonb_build_object('from', v_before.price_cents, 'to', p_price_cents),
    'tax', jsonb_build_object('from', v_before.tax_category_code, 'to', p_tax_category),
    'available', jsonb_build_object('from', v_before.is_available, 'to', coalesce(p_is_available, v_before.is_available))));
  return v_name;
end;
$$;

-------------------------------------------------------------------------------
-- add_menu_option: an option waiters choose from when they tap the item, such as "Shrimp". It has the item's price,
-- tax, and on/off. Returns its id. Errors: menu_item_not_found, invalid_option, option_taken.
-------------------------------------------------------------------------------
create function public.add_menu_option(p_item_id bigint, p_label text, p_actor uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_item  public.menu_items%rowtype;
  v_label text := btrim(coalesce(p_label, ''));
  v_name  text;
  v_id    bigint;
begin
  select * into v_item from public.menu_items where id = p_item_id for update;
  if not found or v_item.is_retired or v_item.parent_item_id is not null then
    raise exception 'menu_item_not_found' using detail = coalesce(p_item_id::text, '');
  end if;
  v_name := public.menu_option_base(v_item.name) || ' (' || v_label || ')';
  if char_length(v_label) not between 1 and 40 or v_label ~ '[()]' or char_length(v_name) > 80 then
    raise exception 'invalid_option';
  end if;
  if exists (select 1 from public.menu_items c where c.parent_item_id = p_item_id and not c.is_retired and lower(c.choice_label) = lower(v_label))
     or exists (select 1 from public.menu_items i where i.category_id = v_item.category_id and lower(i.name) = lower(v_name)) then
    raise exception 'option_taken' using detail = v_label;
  end if;

  insert into public.menu_items (category_id, parent_item_id, choice_label, name, description, price_cents, tax_category_code,
                                 is_available, sort_order)
  values (v_item.category_id, p_item_id, v_label, v_name, v_item.description, v_item.price_cents, v_item.tax_category_code,
          v_item.is_available,
          greatest(100000, coalesce((select max(i.sort_order) from public.menu_items i
                                      where i.category_id = v_item.category_id and i.sort_order between 100000 and 199999), 0) + 1))
  returning id into v_id;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_option_added', jsonb_build_object('item', p_item_id, 'name', v_item.name, 'option', v_label, 'option_item', v_id));
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- remove_menu_item: takes an item, with its options, or one option off the menu for good. Saved tickets still point
-- to it, so it is retired, not deleted, and renamed so its name can be used again. Returns the name it had.
-- Errors: menu_item_not_found.
-------------------------------------------------------------------------------
create function public.remove_menu_item(p_item_id bigint, p_actor uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_item public.menu_items%rowtype;
begin
  select * into v_item from public.menu_items where id = p_item_id for update;
  if not found or v_item.is_retired then
    raise exception 'menu_item_not_found' using detail = coalesce(p_item_id::text, '');
  end if;

  update public.menu_items i
     set is_retired = true, is_available = false, sort_order = 200000 + i.id,
         name = left(i.name, 60) || ' [removed ' || i.id || ']'
   where (i.id = p_item_id or i.parent_item_id = p_item_id) and not i.is_retired;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_item_removed', jsonb_build_object('item', p_item_id, 'name', v_item.name,
          'option_of', v_item.parent_item_id));
  return v_item.name;
end;
$$;

-------------------------------------------------------------------------------
-- Security: for the server role only.
-------------------------------------------------------------------------------
revoke execute on function
  public.menu_option_base(text),
  public.add_menu_item(bigint, text, text, integer, text, uuid),
  public.update_menu_item_details(bigint, text, text, integer, text, boolean, uuid),
  public.add_menu_option(bigint, text, uuid),
  public.remove_menu_item(bigint, uuid)
from public, anon, authenticated;
grant execute on function
  public.menu_option_base(text),
  public.add_menu_item(bigint, text, text, integer, text, uuid),
  public.update_menu_item_details(bigint, text, text, integer, text, boolean, uuid),
  public.add_menu_option(bigint, text, uuid),
  public.remove_menu_item(bigint, uuid)
to service_role;
