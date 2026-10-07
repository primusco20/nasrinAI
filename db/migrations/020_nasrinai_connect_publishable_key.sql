begin;

-- Connect has a narrower key-minting surface than the general key-management RPC.
-- Only publishable chat keys with exactly one HTTPS origin are accepted.
create or replace function public.create_connect_publishable_key(
  p_tenant uuid,
  p_origin text,
  p_label text default 'NasrinAI Connect'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := encode(extensions.gen_random_bytes(6), 'hex');
  v_origin text := lower(rtrim(coalesce(p_origin, ''), '/'));
begin
  if p_tenant is null then
    raise exception 'tenant is required';
  end if;

  if v_origin !~ '^https://[a-z0-9.-]+$' then
    raise exception 'origin must be an HTTPS origin';
  end if;

  if not exists (
    select 1 from public.tenants
    where id = p_tenant
      and status = 'active'
  ) then
    raise exception 'tenant is not active';
  end if;

  insert into public.api_keys (
    id, tenant_id, kind, label, scopes, allowed_origins
  )
  values (
    v_id,
    p_tenant,
    'publishable',
    left(coalesce(p_label, 'NasrinAI Connect'), 80),
    array['chat']::text[],
    array[v_origin]::text[]
  );

  return 'nsp_' || v_id;
end;
$$;

revoke execute on function public.create_connect_publishable_key(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_connect_publishable_key(uuid, text, text)
  to service_role;

commit;
