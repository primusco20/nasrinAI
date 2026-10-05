-- Checks for migration 006 (connectors). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$ begin
  insert into public.connectors (tenant_id, name, base_url, auth_type, auth_header, secret_enc, actions)
  values ('00000000-0000-0000-0000-000000000001', 'shop', 'https://api.shop.example.com/v1', 'header', 'X-Api-Key', 'v1.aa.bb.cc', '[{"name":"order"}]');
  begin
    insert into public.connectors (tenant_id, name, base_url, auth_type, actions)
    values ('00000000-0000-0000-0000-000000000001', 'bad', 'http://insecure.example.com', 'none', '[{}]');
    raise exception 'plain http was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.connectors (tenant_id, name, base_url, auth_type, actions)
    values ('00000000-0000-0000-0000-000000000001', 'nokey', 'https://x.example.com', 'bearer', '[{}]');
    raise exception 'auth without a secret was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.connectors (tenant_id, name, base_url, auth_type, secret_enc, actions)
    values ('00000000-0000-0000-0000-000000000001', 'plain', 'https://x.example.com', 'bearer', 'sk_live_plaintext', '[{}]');
    raise exception 'an unencrypted secret was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.connectors (tenant_id, name, base_url, auth_type, actions)
    values ('00000000-0000-0000-0000-000000000001', 'shop', 'https://y.example.com', 'none', '[{}]');
    raise exception 'two connectors with one name';
  exception when unique_violation then null; end;
  insert into public.api_keys (id, tenant_id, kind, secret_hash, scopes)
  values ('cccccccc0006', '00000000-0000-0000-0000-000000000001', 'secret', repeat('a', 64), array['chat', 'connectors']);
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.connectors; raise exception 'anon could read connectors';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.connectors; raise exception 'signed-in users could read connectors';
exception when insufficient_privilege then null; end $$;
reset role;
select 'connector checks passed' as result;
