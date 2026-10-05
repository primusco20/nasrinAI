-- Checks for migration 010 (connector OAuth). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$ begin
  insert into public.connectors (tenant_id, name, base_url, auth_type, secret_enc, oauth, actions)
  values ('00000000-0000-0000-0000-000000000001', 'crm', 'https://api.crm.example.com', 'oauth2', 'v1.aa.bb.cc',
          '{"token_url":"https://auth.crm.example.com/token","client_id":"abc"}', '[{"name":"x"}]');
  begin
    insert into public.connectors (tenant_id, name, base_url, auth_type, secret_enc, actions)
    values ('00000000-0000-0000-0000-000000000001', 'crm2', 'https://api.crm.example.com', 'oauth2', 'v1.aa.bb.cc', '[{}]');
    raise exception 'oauth2 without settings was accepted';
  exception when check_violation then null; end;
end $$;
reset role;
select 'connector oauth checks passed' as result;
