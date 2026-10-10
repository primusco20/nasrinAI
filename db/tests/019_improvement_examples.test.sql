-- Checks for migration 019 (private improvement-example store). Run via db/tests/run.sh.
\set ON_ERROR_STOP on

insert into public.improvement_consent_events
  (tenant_id, subject_type, subject_id, version, decision, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-live', 'example-v1', 'granted', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-withdrawn', 'example-v1', 'granted', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-withdrawn', 'example-v1', 'withdrawn', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000001', 'guest', 'g-019-expired', 'example-v1', 'granted', now() - interval '1 hour');

insert into public.improvement_examples
  (tenant_id, subject_type, subject_id, consent_version, example_text, status, created_at, expires_at) values
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-live', 'example-v1', 'redacted test example', 'pending_review', now() - interval '1 hour', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-withdrawn', 'example-v1', 'withdrawn test example', 'pending_review', now() - interval '1 hour', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'guest', 'g-019-expired', 'example-v1', 'expired guest example', 'pending_review', now() - interval '25 hours', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-timeout', 'example-v1', 'expired retention example', 'pending_review', now() - interval '2 days', now() - interval '1 second');

do $$
begin
  if has_table_privilege('anon', 'public.improvement_examples', 'select')
     or has_table_privilege('anon', 'public.improvement_examples', 'insert')
     or has_table_privilege('authenticated', 'public.improvement_examples', 'select')
     or has_table_privilege('authenticated', 'public.improvement_examples', 'insert') then
    raise exception 'browser roles have direct improvement-example access';
  end if;
  if not has_table_privilege('service_role', 'public.improvement_examples', 'select')
     or not has_table_privilege('service_role', 'public.improvement_examples', 'insert')
     or not has_table_privilege('service_role', 'public.improvement_examples', 'delete') then
    raise exception 'service role lacks required improvement-example access';
  end if;
end $$;

do $$
begin
  begin
    insert into public.improvement_examples
      (tenant_id, subject_type, subject_id, consent_version, example_text, expires_at)
    values ('00000000-0000-0000-0000-000000000001', 'user', 'u-019-no-capture', '2026-10-10-preference-only', 'must not be accepted', now() + interval '1 day');
    raise exception 'preference-only consent version was accepted for an example';
  exception when check_violation then null;
  end;
end $$;

set role anon;
do $$ begin
  perform public.purge_improvement_examples(); raise exception 'anon could run example purge';
exception when insufficient_privilege then null; end $$;
reset role;

set role service_role;
select public.purge_improvement_examples();
reset role;

do $$
begin
  if not exists (select 1 from public.improvement_examples where subject_id = 'u-019-live') then
    raise exception 'valid, unexpired example with active consent was deleted';
  end if;
  if exists (select 1 from public.improvement_examples where subject_id in ('u-019-withdrawn', 'g-019-expired', 'u-019-timeout')) then
    raise exception 'withdrawn, expired guest, or expired example was retained';
  end if;
end $$;

delete from public.improvement_examples where subject_id like '%-019-%';
delete from public.improvement_consent_events where subject_id like '%-019-%';
select 'improvement example store checks passed' as result;
