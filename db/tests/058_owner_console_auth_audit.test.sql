-- Platform Auth audit summaries expose only aggregate categories and remain server-role only.
\set ON_ERROR_STOP on

do $owner_auth_audit_permissions$
begin
  if has_function_privilege('anon', 'public.owner_console_auth_audit_summary(timestamptz)', 'EXECUTE') then
    raise exception 'anon must not execute owner auth audit summary';
  end if;
  if has_function_privilege('authenticated', 'public.owner_console_auth_audit_summary(timestamptz)', 'EXECUTE') then
    raise exception 'authenticated must not execute owner auth audit summary';
  end if;
  if not has_function_privilege('service_role', 'public.owner_console_auth_audit_summary(timestamptz)', 'EXECUTE') then
    raise exception 'service_role must execute owner auth audit summary';
  end if;
end;
$owner_auth_audit_permissions$;

set role service_role;
do $owner_auth_audit_shape$
declare
  v_summary jsonb;
begin
  v_summary := public.owner_console_auth_audit_summary(now() - interval '1 hour');
  if jsonb_typeof(v_summary) <> 'object' then
    raise exception 'auth audit summary must be an object';
  end if;
  if jsonb_typeof(v_summary->'available') <> 'boolean' then
    raise exception 'auth audit summary must report source availability';
  end if;
  if jsonb_typeof(v_summary->'event_count') <> 'number' then
    raise exception 'auth audit summary must report aggregate event count';
  end if;
  if jsonb_typeof(v_summary->'by_category') <> 'array' then
    raise exception 'auth audit summary must report category aggregates';
  end if;
  if v_summary ? 'email' or v_summary ? 'ip_address' or v_summary ? 'actor_id' or v_summary ? 'payload' then
    raise exception 'auth audit summary must not expose identifying fields or raw payloads';
  end if;
end;
$owner_auth_audit_shape$;
reset role;
