-- Once a kitchen receipt has printed, taking food off that order needs a manager's PIN: removing a line,
-- lowering its quantity, or cancelling the ticket. Adding never does. The app compares the PIN, using the same
-- tries and lockout as the PIN screen, and says here which manager approved. Browsers can't call these.

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'chips_undone', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'shift_finished', 'rotation_changed', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed', 'sections_remapped',
  'ticket_saved', 'ticket_cancelled', 'ticket_changed', 'order_saved',
  'ticket_printed', 'ticket_reprinted', 'print_outcome',
  'kitchen_print_requested', 'customer_print_requested', 'ticket_finalized',
  'pin_login', 'pin_failed', 'pin_lockout', 'pin_locked', 'pin_set', 'pin_disabled', 'pin_approved'
));

-------------------------------------------------------------------------------
-- approving_manager: the employee number of the manager approving, null when nobody is.
-- Errors: pin_not_allowed
-------------------------------------------------------------------------------
create function public.approving_manager(p_employee_id bigint)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_number text;
begin
  if p_employee_id is null then
    return null;
  end if;
  select e.employee_number into v_number
    from public.employees e
    join public.employee_pins p on p.employee_id = e.id and p.disabled_at is null
   where e.id = p_employee_id and e.is_active and e.role_code = 'manager';
  if v_number is null then
    raise exception 'pin_not_allowed';
  end if;
  return v_number;
end;
$$;

-------------------------------------------------------------------------------
-- require_removal_approval: refuses taking food off an order the kitchen has, without a manager.
-- p_quantity is what the line would become; 0 removes it. Raising a quantity needs no approval.
-- Errors: manager_approval_required
-------------------------------------------------------------------------------
create function public.require_removal_approval(p_ticket_id bigint, p_line_id bigint, p_quantity integer, p_approved_by bigint)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_approved_by is null and exists (
    select 1 from public.ticket_lines l
      join public.ticket_batches b on b.id = l.batch_id
     where l.id = p_line_id and l.ticket_id = p_ticket_id and b.kitchen_printed_at is not null and p_quantity < l.quantity
  ) then
    raise exception 'manager_approval_required' using detail = p_line_id::text;
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- pin_approve: the PIN matched, for an approval rather than a session. Clears the tries, records it, and
-- returns the manager. Errors: pin_not_allowed
-------------------------------------------------------------------------------
create function public.pin_approve(p_number text, p_user_id uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_employee public.employees;
begin
  v_employee := public.pin_employee(p_number);
  perform public.approving_manager(coalesce(v_employee.id, 0));

  delete from public.pin_attempts where attempt_key = public.pin_attempt_key(p_number);
  insert into public.audit_events (actor_id, event_type, details)
  values (p_user_id, 'pin_approved', jsonb_build_object('employee_number', v_employee.employee_number));
  return v_employee.id;
end;
$$;

-------------------------------------------------------------------------------
-- change_ticket and cancel_order: as before, and refusing removals the kitchen already has without a manager.
-- The old signatures go, so nothing can call around the check. The previous app build still works: it leaves
-- p_approved_by out, so it can change what the kitchen hasn't got.
-------------------------------------------------------------------------------
drop function public.change_ticket(bigint, integer, bigint, jsonb, uuid);
drop function public.cancel_order(bigint, integer, bigint, uuid);

create function public.change_ticket(
  p_ticket_id        bigint,
  p_expected_version integer,
  p_employee_id      bigint,
  p_changes          jsonb,
  p_actor            uuid,
  p_approved_by      bigint default null
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
  v_manager text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) not between 1 and 100 then
    raise exception 'invalid_changes';
  end if;

  perform public.require_active_employee(p_employee_id);
  v_manager := public.approving_manager(p_approved_by);

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
        perform public.require_removal_approval(v_ticket.id, (v_c ->> 'line_id')::bigint, (v_c ->> 'quantity')::integer, p_approved_by);
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
        perform public.require_removal_approval(v_ticket.id, (v_c ->> 'line_id')::bigint, 0, p_approved_by);
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
    'ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'changes', p_changes, 'before', v_before, 'approved_by', v_manager));
  return v_ticket.version;
end;
$$;

create function public.cancel_order(
  p_ticket_id        bigint,
  p_expected_version integer,
  p_employee_id      bigint,
  p_actor            uuid,
  p_approved_by      bigint default null
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_ticket  public.tickets%rowtype;
  v_manager text;
begin
  perform public.require_active_employee(p_employee_id);
  v_manager := public.approving_manager(p_approved_by);
  v_ticket := public.lock_order_ticket(p_ticket_id, p_expected_version);

  if p_approved_by is null and exists (
    select 1 from public.ticket_batches b
     where b.ticket_id = v_ticket.id and b.kitchen_printed_at is not null
       and exists (select 1 from public.ticket_lines l where l.batch_id = b.id)
  ) then
    raise exception 'manager_approval_required' using detail = v_ticket.ticket_number::text;
  end if;

  update public.tickets t
     set status = 'cancelled', cancelled_at = now(), cancelled_by_employee_id = p_employee_id, version = t.version + 1
   where t.id = v_ticket.id;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'ticket_cancelled', v_ticket.visit_id,
          jsonb_build_object('ticket', v_ticket.ticket_number, 'employee', p_employee_id, 'approved_by', v_manager));
  return v_ticket.ticket_number;
end;
$$;

-------------------------------------------------------------------------------
-- Security: functions for the server role only.
-------------------------------------------------------------------------------
revoke execute on function
  public.approving_manager(bigint),
  public.require_removal_approval(bigint, bigint, integer, bigint),
  public.pin_approve(text, uuid),
  public.change_ticket(bigint, integer, bigint, jsonb, uuid, bigint),
  public.cancel_order(bigint, integer, bigint, uuid, bigint)
from public, anon, authenticated;

grant execute on function
  public.approving_manager(bigint),
  public.require_removal_approval(bigint, bigint, integer, bigint),
  public.pin_approve(text, uuid),
  public.change_ticket(bigint, integer, bigint, jsonb, uuid, bigint),
  public.cancel_order(bigint, integer, bigint, uuid, bigint)
to service_role;
