-- To-go orders. A ticket belongs to a table, and a table has one open ticket, so to-go orders use a set of
-- 30 spots that aren't on the Floor: To-Go 1, To-Go 2, and so on. Each new order takes the first free spot, and
-- a spot is free again once its ticket is finalized or cancelled. Everything after that works as at any table.

insert into public.floor_areas (code, name, floor_row, floor_col, row_span, col_span, sort_order)
values ('TOGO', 'To-Go', 99, 1, 1, 1, 99);

insert into public.sections (code, name, kind, rotation_order, is_open, open_to_all_waiters, sort_order)
values ('TOGO', 'To-Go', 'party', null, true, false, 99);

insert into public.restaurant_tables (code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order)
select 'TOGO-' || n, 'To-Go ' || n, 'TOGO', null, 'TOGO', 1, n, n
  from generate_series(1, 30) as n;

-------------------------------------------------------------------------------
-- save_to_go_order: saves a new to-go order at the first free spot, and says which spot. Saving the same
-- p_client_key again returns the first result. Allocations run one after the other, so two waiters at the same
-- moment get two spots. Errors: to_go_full, and those of save_table_order
-------------------------------------------------------------------------------
create function public.save_to_go_order(
  p_employee_id bigint,
  p_client_key  uuid,
  p_lines       jsonb,
  p_notes       text,
  p_time_zone   text,
  p_actor       uuid
)
returns table (ticket_id bigint, ticket_number bigint, version integer, batch_id bigint, batch_no integer, already_saved boolean, table_code text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('el-lorito-to-go-spots'));

  select rt.code into v_code
    from public.ticket_batches b
    join public.tickets t on t.id = b.ticket_id
    join public.restaurant_tables rt on rt.id = t.table_id
   where b.client_key = p_client_key;

  if v_code is null then
    select rt.code into v_code
      from public.restaurant_tables rt
     where rt.section_code = 'TOGO' and rt.is_active
       and not exists (select 1 from public.tickets t where t.table_id = rt.id and t.status = 'open' and not t.legacy_single_order)
     order by rt.sort_order
     limit 1;
    if v_code is null then
      raise exception 'to_go_full';
    end if;
  end if;

  return query
    select s.ticket_id, s.ticket_number, s.version, s.batch_id, s.batch_no, s.already_saved, v_code
      from public.save_table_order(v_code, p_employee_id, p_client_key, p_lines, p_notes, p_time_zone, p_actor) s;
end;
$$;

revoke execute on function public.save_to_go_order(bigint, uuid, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.save_to_go_order(bigint, uuid, jsonb, text, text, uuid) to service_role;
