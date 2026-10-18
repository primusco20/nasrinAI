-- Migration 042: browser roles cannot read/write credentials or OAuth state.
begin;

insert into public.integration_connections
  (tenant_id, user_id, provider, provider_account_id, account_label, credential_enc, scopes)
values
  ('00000000-0000-0000-0000-000000000001', 'user-1', 'render', 'acct-a', 'Production', 'v1.a.b.c', array['services:read']);

do $$
begin
  if has_table_privilege('anon', 'public.integration_connections', 'select')
     or has_table_privilege('authenticated', 'public.integration_connections', 'select')
     or has_table_privilege('authenticated', 'public.integration_connections', 'insert')
     or has_table_privilege('anon', 'public.integration_oauth_states', 'select')
     or has_table_privilege('authenticated', 'public.integration_oauth_states', 'insert') then
    raise exception '042: browser roles must not access integration credential tables';
  end if;
  begin
    insert into public.integration_connections
      (tenant_id, user_id, provider, provider_account_id, credential_enc)
    values
      ('00000000-0000-0000-0000-000000000001', 'user-2', 'render', 'acct-b', 'plaintext-token');
    raise exception '042: plaintext credentials must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.integration_connections
      (tenant_id, user_id, provider, provider_account_id, credential_enc)
    values
      ('00000000-0000-0000-0000-000000000001', 'user-1', 'render', 'acct-a', 'v1.other.cipher');
    raise exception '042: duplicate user/provider/account connection must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into public.integration_connections
      (tenant_id, user_id, provider, provider_account_id, credential_enc)
    values
      ('00000000-0000-0000-0000-000000000001', 'user-1', 'not-a-provider', 'acct-x', 'v1.a.b.c');
    raise exception '042: unknown providers must be refused';
  exception when check_violation then null;
  end;
end $$;

rollback;
