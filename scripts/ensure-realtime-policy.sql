-- Makes sure the Realtime listening rule from migration 20261027110000_live_sync exists.
-- On Supabase's hosted projects the migration creates it (realtime.messages already exists then).
-- On a local `supabase start` the Realtime service may create realtime.messages after the
-- migrations ran; run this once afterwards (CI does). Safe to run any number of times.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages does not exist (Realtime not running?): nothing to do';
    return;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
             and policyname = 'Active staff hear restaurant updates') then
    raise notice 'Realtime policy already present';
    return;
  end if;
  create policy "Active staff hear restaurant updates"
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.topic() = 'restaurant'
      and realtime.messages.extension = 'broadcast'
      and (select private.is_active_staff())
    );
  raise notice 'Realtime policy created';
end;
$$;
