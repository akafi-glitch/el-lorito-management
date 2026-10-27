-- Phase 10: live updates across devices.
--
-- How it works (no restaurant data ever goes to the browser this way):
-- 1. Every change to a group of tables raises that topic's version in public.sync_versions
--    (floor, staff, menu, tickets), inside the same transaction as the change.
-- 2. The same trigger sends a tiny Supabase Realtime broadcast ("floor changed, version 42") on the
--    private channel "restaurant". Only signed-in, active administrator accounts may receive it
--    (policy on realtime.messages). Nobody may send on it from a browser.
-- 3. A screen that hears a topic it shows reloads its data through the server, as usual.
-- 4. If the live connection drops, screens ask the server for the versions every few seconds and
--    reload when one has moved, so no change is missed.
--
-- A failure to send the live signal never blocks a restaurant change (the counter still moves).

-------------------------------------------------------------------------------
-- Versions per topic
-------------------------------------------------------------------------------
create table public.sync_versions (
  topic       text primary key check (topic in ('floor', 'staff', 'menu', 'tickets')),
  version     bigint not null default 0 check (version >= 0),
  changed_at  timestamptz not null default now()
);

insert into public.sync_versions (topic) values ('floor'), ('staff'), ('menu'), ('tickets');

alter table public.sync_versions enable row level security;
revoke all on table public.sync_versions from anon, authenticated;
grant select on table public.sync_versions to service_role;

-------------------------------------------------------------------------------
-- send_live_signal: one Supabase Realtime broadcast on the private "restaurant" channel.
-- Realtime is present on Supabase projects and absent in plain test databases.
-------------------------------------------------------------------------------
create function public.send_live_signal(p_topic text, p_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, true)'
      using jsonb_build_object('topic', p_topic, 'version', p_version), p_topic, 'restaurant';
  end if;
end;
$$;

revoke execute on function public.send_live_signal(text, bigint) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- note_change: statement trigger. TG_ARGV[0] is the topic.
-- Security definer so it can always raise the counter and send the signal, whoever made the
-- change; it can't be called directly (trigger functions aren't callable, and execute is revoked).
-------------------------------------------------------------------------------
create function public.note_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic   text := tg_argv[0];
  v_version bigint;
begin
  update public.sync_versions
     set version = version + 1, changed_at = now()
   where topic = v_topic
  returning version into v_version;

  begin
    perform public.send_live_signal(v_topic, v_version);
  exception when others then
    raise warning 'live signal for % not sent: %', v_topic, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.note_change() from public, anon, authenticated;

-- Floor: who sits where, chips, clearing, sections, layout.
create trigger sync_floor_customer_visits after insert or update or delete on public.customer_visits
  for each statement execute function public.note_change('floor');
create trigger sync_floor_visit_tables after insert or update or delete on public.visit_tables
  for each statement execute function public.note_change('floor');
create trigger sync_floor_sections after insert or update or delete on public.sections
  for each statement execute function public.note_change('floor');
create trigger sync_floor_restaurant_tables after insert or update or delete on public.restaurant_tables
  for each statement execute function public.note_change('floor');
create trigger sync_floor_rotation after insert or update or delete on public.rotation_state
  for each statement execute function public.note_change('floor');
create trigger sync_floor_combinations after insert or update or delete on public.table_combinations
  for each statement execute function public.note_change('floor');
create trigger sync_floor_combination_members after insert or update or delete on public.table_combination_members
  for each statement execute function public.note_change('floor');

-- Staff: shifts, who works where, employees.
create trigger sync_staff_shifts after insert or update or delete on public.shifts
  for each statement execute function public.note_change('staff');
create trigger sync_staff_assignments after insert or update or delete on public.shift_assignments
  for each statement execute function public.note_change('staff');
create trigger sync_staff_employees after insert or update or delete on public.employees
  for each statement execute function public.note_change('staff');

-- Menu: items, prices, availability, categories, tax rates.
create trigger sync_menu_items after insert or update or delete on public.menu_items
  for each statement execute function public.note_change('menu');
create trigger sync_menu_categories after insert or update or delete on public.menu_categories
  for each statement execute function public.note_change('menu');
create trigger sync_menu_tax_groups after insert or update or delete on public.tax_groups
  for each statement execute function public.note_change('menu');

-- Tickets: saved, changed, cancelled, printed.
create trigger sync_tickets after insert or update or delete on public.tickets
  for each statement execute function public.note_change('tickets');
create trigger sync_ticket_lines after insert or update or delete on public.ticket_lines
  for each statement execute function public.note_change('tickets');

-------------------------------------------------------------------------------
-- Who may hear the live signals: signed-in accounts that are active administrators.
-- The check lives in a schema the API doesn't expose, and only answers for the caller.
-------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

create function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.is_active)
$$;

revoke execute on function private.is_active_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_active_staff() to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "Active staff hear restaurant updates"
        on realtime.messages
        for select
        to authenticated
        using (
          realtime.topic() = 'restaurant'
          and realtime.messages.extension = 'broadcast'
          and (select private.is_active_staff())
        )
    $policy$;
  end if;
end;
$$;
