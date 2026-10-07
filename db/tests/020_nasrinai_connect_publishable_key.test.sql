-- Checks for migration 020 (Connect's own key function). Run via db/tests/run.sh.
\set ON_ERROR_STOP on

-- The browser roles cannot mint keys.
set role anon;
do $$ begin
  perform public.create_connect_publishable_key('00000000-0000-0000-0000-000000000001', 'https://anon.example.com');
  raise exception 'anon could mint a Connect key';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin
  perform public.create_connect_publishable_key('00000000-0000-0000-0000-000000000001', 'https://auth.example.com');
  raise exception 'authenticated could mint a Connect key';
exception when insufficient_privilege then null; end $$;
reset role;

-- The server role can, and only publishable, chat-only, one-origin keys come out.
set role service_role;
do $$
declare
  t uuid; sus uuid; k text; r record; o text;
begin
  insert into public.tenants (name) values ('Connect key test') returning id into t;
  insert into public.tenants (name, status) values ('Connect key test (suspended)', 'suspended') returning id into sus;

  k := public.create_connect_publishable_key(t, 'https://Shop020.Example.com/', 'Website widget');
  if k !~ '^nsp_[0-9a-f]{12}$' then raise exception 'unexpected key shape %', k; end if;
  select kind, label, scopes, allowed_origins, secret_hash, revoked_at, tenant_id into r
    from public.api_keys where id = substr(k, 5);
  if r.kind <> 'publishable' then raise exception 'key kind is %', r.kind; end if;
  if r.scopes <> array['chat']::text[] then raise exception 'key scopes are %', r.scopes; end if;
  if r.allowed_origins <> array['https://shop020.example.com']::text[] then raise exception 'key origins are %', r.allowed_origins; end if;
  if r.secret_hash is not null or r.revoked_at is not null or r.tenant_id <> t or r.label <> 'Website widget' then
    raise exception 'key row is wrong: %', r;
  end if;

  select label into o from public.api_keys where id = substr(public.create_connect_publishable_key(t, 'https://shop020.example.com'), 5);
  if o <> 'NasrinAI Connect' then raise exception 'default label is %', o; end if;

  -- Anything that is not one plain HTTPS origin is refused.
  foreach o in array array['http://shop020.example.com', 'https://shop020.example.com/path', 'https://shop020.example.com:444',
                           'https://user@shop020.example.com', 'shop020.example.com', ''] loop
    begin
      perform public.create_connect_publishable_key(t, o);
      raise exception 'origin "%" was accepted', o;
    exception when raise_exception then
      if sqlerrm like 'origin "%' then raise; end if;
    end;
  end loop;

  -- Missing, unknown and suspended tenants are refused.
  begin
    perform public.create_connect_publishable_key(null, 'https://shop020.example.com');
    raise exception 'a null tenant was accepted';
  exception when raise_exception then
    if sqlerrm = 'a null tenant was accepted' then raise; end if;
  end;
  begin
    perform public.create_connect_publishable_key(gen_random_uuid(), 'https://shop020.example.com');
    raise exception 'an unknown tenant was accepted';
  exception when raise_exception then
    if sqlerrm = 'an unknown tenant was accepted' then raise; end if;
  end;
  begin
    perform public.create_connect_publishable_key(sus, 'https://shop020.example.com');
    raise exception 'a suspended tenant was accepted';
  exception when raise_exception then
    if sqlerrm = 'a suspended tenant was accepted' then raise; end if;
  end;

  delete from public.tenants where id in (t, sus);
end $$;
reset role;
select 'connect publishable key checks passed' as result;
