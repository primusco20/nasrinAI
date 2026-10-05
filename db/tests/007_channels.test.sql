-- Checks for migration 007 (channels). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$ begin
  insert into public.channels (tenant_id, kind, external_id, secret_enc)
  values ('00000000-0000-0000-0000-000000000001', 'facebook', '1234567890', 'v1.aa.bb.cc');
  begin
    insert into public.channels (tenant_id, kind, external_id, secret_enc)
    values ('00000000-0000-0000-0000-000000000001', 'facebook', '1234567890', 'v1.dd.ee.ff');
    raise exception 'one Page belonged to two businesses';
  exception when unique_violation then null; end;
  begin
    insert into public.channels (tenant_id, kind, external_id, secret_enc)
    values ('00000000-0000-0000-0000-000000000001', 'facebook', '999999', 'EAAplaintoken');
    raise exception 'an unencrypted token was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.channels (tenant_id, kind, external_id, secret_enc)
    values ('00000000-0000-0000-0000-000000000001', 'whatsapp', '999999', 'v1.aa.bb.cc');
    raise exception 'an unknown channel kind was accepted';
  exception when check_violation then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.channels; raise exception 'anon could read channels';
exception when insufficient_privilege then null; end $$;
reset role;
select 'channel checks passed' as result;
