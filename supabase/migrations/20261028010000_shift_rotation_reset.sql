-- A new shift starts the seating rotation again at A.
--
-- Rule (owner decision, Oct 27, 2026): "Start new shift" puts the rotation back at the first section
-- (A, of A, C, B, X(1), X(2), P). During the shift seating moves it as before (seat_party is not
-- changed). Nothing else changes: seated tables stay seated, and visits, tickets, shifts,
-- assignments, and audit history are never deleted.
--
-- The rotation lives in the database (rotation_state), so every device sees the reset: the existing
-- live-sync trigger on rotation_state moves the floor version and signals the floor screens.

-------------------------------------------------------------------------------
-- start_shift: ends the open shift (and its assignments), opens a new one, and resets the rotation.
-------------------------------------------------------------------------------
create or replace function public.start_shift(p_actor uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_old     bigint;
  v_new     bigint;
  v_first   text;
  v_current text;
begin
  select id into v_old from public.shifts where ended_at is null for update;

  if v_old is not null then
    update public.shift_assignments set ended_at = now(), ended_by = p_actor
     where shift_id = v_old and ended_at is null;
    update public.shifts set ended_at = now(), ended_by = p_actor where id = v_old;
  end if;

  insert into public.shifts (started_by) values (p_actor) returning id into v_new;

  -- Back to the first section in the rotation. Only written when it changes: the live-sync trigger
  -- runs per statement (even one that changes no rows), so skipping the update keeps a rotation
  -- already at A from refreshing every floor screen for nothing.
  select code into v_first from public.sections where rotation_order is not null order by rotation_order limit 1;
  select next_section_code into v_current from public.rotation_state where id = 1 for update;
  if v_current is distinct from v_first then
    update public.rotation_state set next_section_code = v_first, updated_at = now() where id = 1;
  end if;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'shift_started',
          jsonb_build_object('shift', v_new, 'previous_shift', v_old, 'rotation_next', v_first));
  return v_new;
end;
$$;

-- Same rights as before: only the server may call it.
revoke execute on function public.start_shift(uuid) from public, anon, authenticated;
grant execute on function public.start_shift(uuid) to service_role;
