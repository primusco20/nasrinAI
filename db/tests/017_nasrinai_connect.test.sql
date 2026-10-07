-- Checks for migration 017 (Connect installations). Run via db/tests/run.sh.
\set ON_ERROR_STOP on

-- Row level security is on, and the browser roles can touch nothing.
do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.connect_installations'::regclass) then
    raise exception 'connect_installations has no row level security';
  end if;
end $$;

set role anon;
do $$ begin
  perform 1 from public.connect_installations; raise exception 'anon could read connect_installations';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.connect_installations (tenant_id, site_origin, site_host)
  values ('00000000-0000-0000-0000-000000000001', 'https://anon.example.com', 'anon.example.com');
  raise exception 'anon could insert a connect installation';
exception when insufficient_privilege then null; end $$;
reset role;

set role authenticated;
do $$ begin
  perform 1 from public.connect_installations; raise exception 'authenticated could read connect_installations';
exception when insufficient_privilege then null; end $$;
reset role;

-- The server role can use it, and the table's own rules hold.
set role service_role;
do $$
declare t constant uuid := '00000000-0000-0000-0000-000000000001'; s text;
begin
  insert into public.connect_installations (tenant_id, site_origin, site_host)
  values (t, 'https://shop017.example.com', 'shop017.example.com');
  select status into s from public.connect_installations where site_origin = 'https://shop017.example.com';
  if s <> 'discovered' then raise exception 'new site should start as discovered, got %', s; end if;

  begin
    insert into public.connect_installations (tenant_id, site_origin, site_host)
    values (t, 'https://shop017.example.com', 'shop017.example.com');
    raise exception 'the same site was added twice for one business';
  exception when unique_violation then null; end;

  begin
    insert into public.connect_installations (tenant_id, site_origin, site_host, status)
    values (t, 'https://a017.example.com', 'a017.example.com', 'live');
    raise exception 'an unknown status was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.connect_installations (tenant_id, site_origin, site_host)
    values (t, 'http://b017.example.com', 'b017.example.com');
    raise exception 'a non-HTTPS origin was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.connect_installations (tenant_id, site_origin, site_host)
    values (t, 'https://c017.example.com/path', 'c017.example.com');
    raise exception 'an origin with a path was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.connect_installations (tenant_id, site_origin, site_host)
    values (t, 'https://d017.example.com', 'D017.example.com');
    raise exception 'an upper-case host was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.connect_installations (tenant_id, site_origin, site_host, installation_method)
    values (t, 'https://e017.example.com', 'e017.example.com', 'carrier_pigeon');
    raise exception 'an unknown installation method was accepted';
  exception when check_violation then null; end;

  delete from public.connect_installations where site_host like '%017.example.com';
end $$;
reset role;
select 'connect installation checks passed' as result;
