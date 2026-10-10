-- Regression check for migration 023. Functions are optional in the scratch
-- migration-only database because db/semantic_cache.sql is separately installed.
\set ON_ERROR_STOP on

do $$
declare
  function_oid oid;
  settings text[];
begin
  function_oid := to_regprocedure('public.match_semantic_cache(vector,text,text,double precision,integer)');
  if function_oid is not null then
    select proconfig into settings from pg_proc where oid = function_oid;
    if settings is null or not exists (
      select 1 from unnest(settings) as setting
      where replace(setting, ' ', '') = 'search_path=pg_catalog,public'
    ) then
      raise exception 'match_semantic_cache does not have the hardened search_path';
    end if;
  end if;

  function_oid := to_regprocedure('public.touch_semantic_cache(uuid)');
  if function_oid is not null then
    select proconfig into settings from pg_proc where oid = function_oid;
    if settings is null or not exists (
      select 1 from unnest(settings) as setting
      where replace(setting, ' ', '') = 'search_path=pg_catalog,public'
    ) then
      raise exception 'touch_semantic_cache does not have the hardened search_path';
    end if;
  end if;
end
$$;

\echo 'Semantic cache search_path checks passed'
