-- Checks for migration 001. Run against a scratch database (see db/tests/run.sh).
-- Any failed check raises an error and stops the run.
\set ON_ERROR_STOP on

-- 1. The browser roles can touch nothing.
set role anon;
do $$ begin
  perform 1 from public.tenants; raise exception 'anon could read tenants';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.messages (conversation_id, tenant_id, role, content)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'user', 'x');
  raise exception 'anon could insert a message';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.rate_hit('x', 60, 5); raise exception 'anon could call rate_hit';
exception when insufficient_privilege then null; end $$;
reset role;

set role authenticated;
do $$ begin
  perform 1 from public.api_keys; raise exception 'authenticated could read api_keys';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.usage_tokens_since(now()); raise exception 'authenticated could read usage';
exception when insufficient_privilege then null; end $$;
reset role;

-- 2. The server role can do its job but cannot mint keys.
set role service_role;
do $$ begin
  if not exists (select 1 from public.tenants where id = '00000000-0000-0000-0000-000000000001' and kind = 'platform') then
    raise exception 'platform tenant missing';
  end if;
end $$;
do $$ begin
  perform public.create_api_key('00000000-0000-0000-0000-000000000001', 'secret');
  raise exception 'service_role could create a key';
exception when insufficient_privilege then null; end $$;

-- 3. Rate limits: the third hit in a window is refused.
do $$
declare r record; n int := 0;
begin
  for i in 1..3 loop
    select * into r from public.rate_hit('test:bucket', 3600, 2);
    if r.allowed then n := n + 1; end if;
  end loop;
  if n <> 2 then raise exception 'expected 2 allowed hits, got %', n; end if;
  if not (r.used = 3 and r.retry_after between 1 and 3600) then
    raise exception 'unexpected rate_hit result %', r;
  end if;
end $$;

-- 4. Conversations, the updated_at trigger, and tenant consistency.
do $$
declare c uuid; before timestamptz;
begin
  insert into public.conversations (tenant_id, owner_type, owner_id, updated_at)
  values ('00000000-0000-0000-0000-000000000001', 'guest', 'g1', now() - interval '1 hour')
  returning id, updated_at into c, before;
  insert into public.messages (conversation_id, tenant_id, role, content)
  values (c, '00000000-0000-0000-0000-000000000001', 'user', 'hello');
  if (select updated_at from public.conversations where id = c) <= before then
    raise exception 'trigger did not touch updated_at';
  end if;
end $$;
reset role;

insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000b1', 'Test business');
set role service_role;
do $$
declare c uuid;
begin
  select id into c from public.conversations where owner_id = 'g1';
  insert into public.messages (conversation_id, tenant_id, role, content)
  values (c, '00000000-0000-0000-0000-0000000000b1', 'user', 'cross-tenant');
  raise exception 'a message was attached to another tenant''s conversation';
exception when foreign_key_violation then null; end $$;

-- 5. Usage totals.
insert into public.usage_events (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, outcome)
values ('00000000-0000-0000-0000-000000000001', 'guest', 'g1', 'fake', 'm', 100, 50, 'ok'),
       ('00000000-0000-0000-0000-000000000001', 'user', 'u1', 'fake', 'm', 10, 5, 'ok'),
       ('00000000-0000-0000-0000-0000000000b1', 'guest', 'g9', 'fake', 'm', 1000, 0, 'ok');
do $$ begin
  if public.usage_tokens_since(now() - interval '1 hour', '00000000-0000-0000-0000-000000000001', 'guest') <> 150 then
    raise exception 'platform guest total wrong';
  end if;
  if public.usage_tokens_since(now() - interval '1 hour', '00000000-0000-0000-0000-000000000001') <> 165 then
    raise exception 'platform total wrong';
  end if;
  if public.usage_tokens_since(now() - interval '1 hour', null, 'user', 'u1') <> 15 then
    raise exception 'per-user total wrong';
  end if;
end $$;

-- 6. Expired guest conversations are purged with their messages.
do $$
declare c uuid;
begin
  insert into public.conversations (tenant_id, owner_type, owner_id, expires_at)
  values ('00000000-0000-0000-0000-000000000001', 'guest', 'old', now() - interval '1 minute') returning id into c;
  insert into public.messages (conversation_id, tenant_id, role, content)
  values (c, '00000000-0000-0000-0000-000000000001', 'user', 'bye');
  perform public.purge_expired();
  if exists (select 1 from public.conversations where id = c) or exists (select 1 from public.messages where conversation_id = c) then
    raise exception 'expired conversation not purged';
  end if;
  if not exists (select 1 from public.conversations where owner_id = 'g1') then
    raise exception 'a live conversation was purged';
  end if;
end $$;
reset role;

-- 7. Key creation (as the database owner, like the SQL editor).
do $$
declare k text; secret text; kid text;
begin
  begin
    perform public.create_api_key('00000000-0000-0000-0000-0000000000b1', 'publishable', 'site');
    raise exception 'publishable key without origins was accepted';
  exception when check_violation then null; end;

  begin
    perform public.create_api_key('00000000-0000-0000-0000-0000000000b1', 'publishable', 'site', array['javascript:alert(1)']);
    raise exception 'bad origin was accepted';
  exception when raise_exception then
    if sqlerrm not like 'each origin%' then raise; end if;
  end;

  begin
    perform public.create_api_key('00000000-0000-0000-0000-0000000000b1', 'secret', 'pos', '{}', array['admin']);
    raise exception 'unknown scope was accepted';
  exception when check_violation then null; end;

  k := public.create_api_key('00000000-0000-0000-0000-0000000000b1', 'publishable', 'site', array['https://Shop.example.com/']);
  if k !~ '^nsp_[0-9a-f]{12}$' then raise exception 'bad publishable key %', k; end if;
  if (select allowed_origins from public.api_keys where id = substr(k, 5)) <> array['https://shop.example.com'] then
    raise exception 'origin not normalised';
  end if;

  k := public.create_api_key('00000000-0000-0000-0000-0000000000b1', 'secret', 'pos');
  if k !~ '^nss_[0-9a-f]{12}_[0-9a-f]{48}$' then raise exception 'bad secret key format'; end if;
  kid := substr(k, 5, 12);
  secret := substr(k, 18);
  if (select secret_hash from public.api_keys where id = kid) <> encode(extensions.digest(secret, 'sha256'), 'hex') then
    raise exception 'stored hash does not match the secret';
  end if;
  if exists (select 1 from public.api_keys where secret_hash = secret or id = secret) then
    raise exception 'plain secret stored';
  end if;

  perform public.revoke_api_key(kid);
  if (select revoked_at from public.api_keys where id = kid) is null then raise exception 'revoke failed'; end if;
end $$;

\echo 'ALL DATABASE CHECKS PASSED'
