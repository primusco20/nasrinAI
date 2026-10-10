-- Checks for migration 023 (SECURITY DEFINER search_path hardening).
\set ON_ERROR_STOP on

do $$
declare
  signature text;
  routine regprocedure;
  config text[];
  signatures text[] := array[
    'public.add_plan_period(uuid,text,text,integer,text,text,integer,text)',
    'public.delete_user_data(uuid,text)',
    'public.grant_plan(text,text,integer)',
    'public.purge_retention()',
    'public.purge_retention(integer)',
    'public.purge_user_data_before(uuid,text,timestamp with time zone,boolean)',
    'public.search_knowledge(uuid,text,text,integer)',
    'public.search_library(uuid,text,text,integer)',
    'public.search_library_scoped(uuid,text,uuid,text,integer)',
    'public.usage_cost_since(timestamp with time zone)',
    'public.purge_improvement_consent()'
  ];
begin
  foreach signature in array signatures loop
    routine := to_regprocedure(signature);
    if routine is null then
      raise exception 'expected routine is missing: %', signature;
    end if;

    select p.proconfig into config
      from pg_proc p
     where p.oid = routine;

    if config is null or not (array_to_string(config, ';') like '%search_path=pg_catalog, public%') then
      raise exception 'unsafe search_path for %: %', signature, config;
    end if;
  end loop;
end $$;

-- Hardening must not grant the owner-only manual grant function to API roles.
do $$
begin
  if has_function_privilege('anon', 'public.grant_plan(text,text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.grant_plan(text,text,integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.grant_plan(text,text,integer)', 'EXECUTE') then
    raise exception 'grant_plan must remain owner-only';
  end if;
end $$;

select 'SECURITY DEFINER search_path checks passed' as result;
