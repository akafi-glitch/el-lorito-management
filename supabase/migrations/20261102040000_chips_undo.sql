-- Undo an accidental "chips served": red back to yellow.
--
-- It is refused unless the visit is exactly as the screen saw it, so it can never overwrite what
-- another employee did since (clearing, another undo, serving again). Chips belong to the visit, so
-- joined tables change together. The visit's version moves on, and both the serving and its undo stay
-- in the audit history.

-------------------------------------------------------------------------------
-- undo_chips_served. Returns the new version.
-- Errors: see raise_visit_change_refused, chips_not_served.
-------------------------------------------------------------------------------
create function public.undo_chips_served(p_visit_id bigint, p_expected_version integer, p_actor uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_before  public.customer_visits%rowtype;
  v_version integer;
begin
  select * into v_before from public.customer_visits where id = p_visit_id for update;

  update public.customer_visits
     set chips_status = 'needed', chips_served_at = null, chips_served_by = null, version = version + 1
   where id = p_visit_id and cleared_at is null and chips_status = 'served' and version = p_expected_version
  returning version into v_version;

  if v_version is null then
    perform public.raise_visit_change_refused(p_visit_id, p_expected_version, 'chips_not_served');
  end if;

  insert into public.audit_events (actor_id, event_type, visit_id, details)
  values (p_actor, 'chips_undone', p_visit_id, jsonb_build_object(
    'served_at', v_before.chips_served_at, 'served_by', v_before.chips_served_by, 'version', v_version));
  return v_version;
end;
$$;

revoke execute on function public.undo_chips_served(bigint, integer, uuid) from public, anon, authenticated;
grant execute on function public.undo_chips_served(bigint, integer, uuid) to service_role;
