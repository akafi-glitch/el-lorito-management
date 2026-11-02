-- Corrects which section each X table belongs to (owner's definitive list, Nov 2, 2026):
--   X(1): X4, X5, X6, X7, X8, X9, X13, X14
--   X(2): X1, X2, X3, X10, X11, X12
--
-- Only restaurant_tables.section_code and sort_order change. Table IDs, codes, chairs, and map
-- positions stay, and visits, tickets, and history point at tables by ID, so seated guests and old
-- records are untouched. X6 + X7 + X8 stays approved (now all in X(1)). Running this twice changes nothing.

-------------------------------------------------------------------------------
-- Audit: event types added by this upgrade (all its migrations).
-------------------------------------------------------------------------------
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'chips_undone', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'rotation_changed', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed', 'sections_remapped',
  'ticket_saved', 'ticket_cancelled', 'ticket_changed', 'order_saved',
  'ticket_printed', 'ticket_reprinted', 'print_outcome',
  'kitchen_print_requested', 'customer_print_requested', 'ticket_finalized'
));

-------------------------------------------------------------------------------
-- The new mapping. Two steps, because (section_code, sort_order) must stay unique at every moment.
-------------------------------------------------------------------------------
do $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  select jsonb_object_agg(code, section_code) into v_before from public.restaurant_tables where area_code = 'X';

  update public.restaurant_tables set sort_order = sort_order + 100 where area_code = 'X';

  update public.restaurant_tables t
     set section_code = m.section_code, sort_order = m.sort_order
    from (values
      ('X4',  'X-1', 1), ('X5',  'X-1', 2), ('X6',  'X-1', 3), ('X7',  'X-1', 4),
      ('X8',  'X-1', 5), ('X9',  'X-1', 6), ('X13', 'X-1', 7), ('X14', 'X-1', 8),
      ('X1',  'X-2', 1), ('X2',  'X-2', 2), ('X3',  'X-2', 3),
      ('X10', 'X-2', 4), ('X11', 'X-2', 5), ('X12', 'X-2', 6)
    ) as m (code, section_code, sort_order)
   where t.code = m.code;

  select jsonb_object_agg(code, section_code) into v_after from public.restaurant_tables where area_code = 'X';

  if v_before is distinct from v_after then
    insert into public.audit_events (event_type, details)
    values ('sections_remapped', jsonb_build_object('before', v_before, 'after', v_after));
  end if;
end;
$$;
