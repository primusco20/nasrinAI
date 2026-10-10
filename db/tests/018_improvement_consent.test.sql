-- Checks for migration 018 (improvement consent preference records). Run via db/tests/run.sh.
\set ON_ERROR_STOP on

insert into public.improvement_consent_events
  (tenant_id, subject_type, subject_id, version, decision, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'guest', 'g-018-expired', '2026-10-10-preference-only', 'granted', now() - interval '25 hours'),
  ('00000000-0000-0000-0000-000000000001', 'guest', 'g-018-live',    '2026-10-10-preference-only', 'granted', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000001', 'user',  'u-018-expired', '2026-10-10-preference-only', 'granted', now() - interval '10 years 1 day'),
  ('00000000-0000-0000-0000-000000000001', 'user',  'u-018-live',    '2026-10-10-preference-only', 'granted', now() - interval '1 day');

do $$
begin
  if has_table_privilege('anon', 'public.improvement_consent_events', 'select')
     or has_table_privilege('anon', 'public.improvement_consent_events', 'insert')
     or has_table_privilege('authenticated', 'public.improvement_consent_events', 'select')
     or has_table_privilege('authenticated', 'public.improvement_consent_events', 'insert') then
    raise exception 'browser roles have direct consent table access';
  end if;
  if not has_table_privilege('service_role', 'public.improvement_consent_events', 'select')
     or not has_table_privilege('service_role', 'public.improvement_consent_events', 'insert') then
    raise exception 'service role lacks consent table access';
  end if;
end $$;

set role anon;
do $$ begin
  perform public.purge_improvement_consent(); raise exception 'anon could run consent purge';
exception when insufficient_privilege then null; end $$;
reset role;

set role service_role;
select public.purge_improvement_consent();
reset role;

do $$
begin
  if exists (select 1 from public.improvement_consent_events where subject_id in ('g-018-expired', 'u-018-expired')) then
    raise exception 'purge retained expired consent evidence';
  end if;
  if not exists (select 1 from public.improvement_consent_events where subject_id = 'g-018-live')
     or not exists (select 1 from public.improvement_consent_events where subject_id = 'u-018-live') then
    raise exception 'purge deleted current consent evidence';
  end if;
end $$;

delete from public.improvement_consent_events where subject_id like '%-018-%';
select 'improvement consent checks passed' as result;
