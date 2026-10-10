-- Harden SECURITY DEFINER routines against search_path shadowing.
-- Keep public available for explicitly qualified application objects, but put
-- pg_catalog first and remove pg_temp from the trusted lookup path.
-- This changes function configuration only; execute grants and business logic
-- are intentionally unchanged. Review against the live catalog before applying.

begin;

alter function public.add_plan_period(uuid, text, text, integer, text, text, integer, text)
  set search_path = pg_catalog, public;
alter function public.delete_user_data(uuid, text)
  set search_path = pg_catalog, public;
alter function public.grant_plan(text, text, integer)
  set search_path = pg_catalog, public;
alter function public.purge_retention()
  set search_path = pg_catalog, public;
alter function public.purge_retention(integer)
  set search_path = pg_catalog, public;
alter function public.purge_user_data_before(uuid, text, timestamptz, boolean)
  set search_path = pg_catalog, public;
alter function public.search_knowledge(uuid, text, text, integer)
  set search_path = pg_catalog, public;
alter function public.search_library(uuid, text, text, integer)
  set search_path = pg_catalog, public;
alter function public.search_library_scoped(uuid, text, uuid, text, integer)
  set search_path = pg_catalog, public;
alter function public.usage_cost_since(timestamptz)
  set search_path = pg_catalog, public;
alter function public.purge_improvement_consent()
  set search_path = pg_catalog, public;
alter function public.purge_improvement_examples()
  set search_path = pg_catalog, public;
alter function public.review_improvement_example(uuid, uuid, text, text, text)
  set search_path = pg_catalog, public;
alter function public.delete_improvement_examples_for_subject(uuid, text, text, uuid, text)
  set search_path = pg_catalog, public;

commit;
