-- Checks for migration 023 (SECURITY DEFINER search_path hardening).
\set ON_ERROR_STOP on

do $$
declare
  signature text;
  routine regprocedure;
  config text[];
  is_definer boolean;
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
    'public.purge_improvement_consent()',
    'public.purge_improvement_examples()',
    'public.review_improvement_example(uuid,uuid,text,text,text)',
    'public.delete_improvement_examples_for_subject(uuid,text,text,uuid,text)'
  ];
begin
  foreach signature in array signatures loop
    routine := to_regprocedure(signature);
    if routine is null then
      raise exception 'expected routine is missing: %', signature;
    end if;

    select p.proconfig, p.prosecdef into config, is_definer
      from pg_proc p
     where p.oid = routine;

    if is_definer is distinct from true then
      raise exception 'routine is not SECURITY DEFINER: %', signature;
    end if;

    if config is null or not (array_to_string(config, ';') like '%search_path=pg_catalog, public%') then
      raise exception 'unsafe search_path for %: %', signature, config;
    end if;
  end loop;
end $$;

-- The chosen search_path is safe only if browser roles cannot create objects in public.
do $$
begin
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'browser API roles must not have CREATE on schema public';
  end if;
end $;

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
