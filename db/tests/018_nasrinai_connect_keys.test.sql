-- Checks for migration 018 (no general key minting for the API roles). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(r, 'public.create_api_key(uuid, text, text, text[], text[])', 'execute') then
      raise exception '% can run create_api_key', r;
    end if;
  end loop;
end $$;
select 'connect key lock checks passed' as result;
