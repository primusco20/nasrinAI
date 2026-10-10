-- Harden search_path for semantic-cache functions flagged by Supabase Security Advisor.
-- Use trusted system objects first; public is last and is not writable by browser roles.
-- The functions are installed by db/semantic_cache.sql in some deployments rather than
-- the numbered migration chain, so this migration safely skips them if absent.

begin;

do $$
begin
  if to_regprocedure('public.match_semantic_cache(vector,text,text,double precision,integer)') is not null then
    execute 'alter function public.match_semantic_cache(vector, text, text, double precision, integer) set search_path = pg_catalog, public';
  end if;

  if to_regprocedure('public.touch_semantic_cache(uuid)') is not null then
    execute 'alter function public.touch_semantic_cache(uuid) set search_path = pg_catalog, public';
  end if;
end
$$;

commit;
