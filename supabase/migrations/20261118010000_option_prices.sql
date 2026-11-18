-- An option can cost extra (owner decision, Nov 18, 2026): the manager sets an extra charge on an option, such as
-- Shrimp +$3.00, and the option costs the item's price plus that. Every existing option starts at no extra charge.
-- Saved tickets keep the prices they were saved with.

alter table public.menu_items
  add column extra_cents integer not null default 0 check (extra_cents between 0 and 100000),
  add constraint menu_items_extra_only_on_options check (parent_item_id is not null or extra_cents = 0);

-- An option's price is its item's price plus its extra charge.
create or replace function public.sync_menu_choices()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.menu_items c
     set price_cents = new.price_cents + c.extra_cents, is_available = new.is_available, tax_category_code = new.tax_category_code
   where c.parent_item_id = new.id and not c.is_retired
     and (c.price_cents, c.is_available, c.tax_category_code)
         is distinct from (new.price_cents + c.extra_cents, new.is_available, new.tax_category_code);
  return null;
end;
$$;

-------------------------------------------------------------------------------
-- add_menu_option: as before, with an extra charge in cents (0 for none). The option costs the item's price plus it.
-- The previous build calls it without p_extra_cents, which then means no extra charge.
-- Errors: menu_item_not_found, invalid_option, option_taken, invalid_extra.
-------------------------------------------------------------------------------
drop function public.add_menu_option(bigint, text, uuid);
create function public.add_menu_option(p_item_id bigint, p_label text, p_actor uuid, p_extra_cents integer default 0)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_item  public.menu_items%rowtype;
  v_label text := btrim(coalesce(p_label, ''));
  v_extra integer := coalesce(p_extra_cents, 0);
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
  if v_extra not between 0 and 100000 or v_item.price_cents + v_extra > 1000000 then
    raise exception 'invalid_extra';
  end if;
  if exists (select 1 from public.menu_items c where c.parent_item_id = p_item_id and not c.is_retired and lower(c.choice_label) = lower(v_label))
     or exists (select 1 from public.menu_items i where i.category_id = v_item.category_id and lower(i.name) = lower(v_name)) then
    raise exception 'option_taken' using detail = v_label;
  end if;

  insert into public.menu_items (category_id, parent_item_id, choice_label, name, description, price_cents, extra_cents,
                                 tax_category_code, is_available, sort_order)
  values (v_item.category_id, p_item_id, v_label, v_name, v_item.description, v_item.price_cents + v_extra, v_extra,
          v_item.tax_category_code, v_item.is_available,
          greatest(100000, coalesce((select max(i.sort_order) from public.menu_items i
                                      where i.category_id = v_item.category_id and i.sort_order between 100000 and 199999), 0) + 1))
  returning id into v_id;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_option_added', jsonb_build_object('item', p_item_id, 'name', v_item.name, 'option', v_label,
          'option_item', v_id, 'extra_cents', v_extra));
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- set_menu_option_extra: changes an option's extra charge (0 for none). Returns the option's name.
-- Errors: menu_item_not_found (not an option on the menu), invalid_extra.
-------------------------------------------------------------------------------
create function public.set_menu_option_extra(p_option_id bigint, p_extra_cents integer, p_actor uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_option public.menu_items%rowtype;
  v_item   public.menu_items%rowtype;
  v_extra  integer := coalesce(p_extra_cents, -1);
begin
  select * into v_option from public.menu_items where id = p_option_id for update;
  if not found or v_option.is_retired or v_option.parent_item_id is null then
    raise exception 'menu_item_not_found' using detail = coalesce(p_option_id::text, '');
  end if;
  select * into v_item from public.menu_items where id = v_option.parent_item_id;
  if v_extra not between 0 and 100000 or v_item.price_cents + v_extra > 1000000 then
    raise exception 'invalid_extra';
  end if;
  if v_extra = v_option.extra_cents then
    return v_option.name; -- nothing changed
  end if;

  update public.menu_items set extra_cents = v_extra, price_cents = v_item.price_cents + v_extra where id = p_option_id;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_item_changed', jsonb_build_object(
    'item', p_option_id, 'name', v_option.name, 'option_of', v_item.id,
    'extra_cents', jsonb_build_object('from', v_option.extra_cents, 'to', v_extra)));
  return v_option.name;
end;
$$;

revoke execute on function
  public.add_menu_option(bigint, text, uuid, integer),
  public.set_menu_option_extra(bigint, integer, uuid)
from public, anon, authenticated;
grant execute on function
  public.add_menu_option(bigint, text, uuid, integer),
  public.set_menu_option_extra(bigint, integer, uuid)
to service_role;
