-- Checks for migration 008 (connector events). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$ begin
  insert into public.connector_events (tenant_id, connector, event_id, type, key, data)
  values ('00000000-0000-0000-0000-000000000001', 'pos', 'evt_1', 'order.ready', '1234', '{"status":"ready"}');
  begin
    insert into public.connector_events (tenant_id, connector, event_id, type, data)
    values ('00000000-0000-0000-0000-000000000001', 'pos', 'evt_1', 'order.ready', '{}');
    raise exception 'the same event was stored twice';
  exception when unique_violation then null; end;
  begin
    insert into public.connector_events (tenant_id, connector, event_id, type, data)
    values ('00000000-0000-0000-0000-000000000001', 'pos', 'evt_2', 'order.ready', '[1,2]');
    raise exception 'non-object data was accepted';
  exception when check_violation then null; end;
  begin
    update public.connector_events set type = 'x' where event_id = 'evt_1';
    raise exception 'events could be edited';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.connectors (tenant_id, name, base_url, auth_type, actions, events_who)
    values ('00000000-0000-0000-0000-000000000001', 'evx', 'https://x.example.com', 'none', '[{}]', array['user']);
    raise exception 'an unknown audience was accepted';
  exception when check_violation then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.connector_events; raise exception 'anon could read events';
exception when insufficient_privilege then null; end $$;
reset role;
select 'connector event checks passed' as result;
