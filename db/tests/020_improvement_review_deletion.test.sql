-- Checks for migration 020 (review decisions and deletion lineage).
\set ON_ERROR_STOP on

insert into public.improvement_consent_events
  (tenant_id, subject_type, subject_id, version, decision, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-020-review', 'example-v1', 'granted', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-020-delete', 'example-v1', 'granted', now() - interval '1 hour');

insert into public.improvement_examples
  (tenant_id, subject_type, subject_id, consent_version, example_text, status, created_at, expires_at) values
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-020-review', 'example-v1', 'redacted review candidate one', 'pending_review', now() - interval '30 minutes', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-020-delete', 'example-v1', 'redacted deletion candidate one', 'pending_review', now() - interval '30 minutes', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'u-020-delete', 'example-v1', 'redacted deletion candidate two', 'pending_review', now() - interval '20 minutes', now() + interval '1 day');

do $$
begin
  if has_table_privilege('anon', 'public.improvement_example_review_events', 'select')
     or has_table_privilege('authenticated', 'public.improvement_example_review_events', 'select')
     or has_table_privilege('anon', 'public.improvement_example_deletion_events', 'select')
     or has_table_privilege('authenticated', 'public.improvement_example_deletion_events', 'select') then
    raise exception 'browser roles can read review or deletion audit records';
  end if;
  if has_function_privilege('anon', 'public.review_improvement_example(uuid,uuid,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.review_improvement_example(uuid,uuid,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.delete_improvement_examples_for_subject(uuid,text,text,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.delete_improvement_examples_for_subject(uuid,text,text,uuid,text)', 'execute') then
    raise exception 'browser roles can execute review or deletion functions';
  end if;
end $$;

set role service_role;
select public.review_improvement_example(
  '00000000-0000-0000-0000-000000000001',
  (select id from public.improvement_examples where subject_id = 'u-020-review'),
  'reviewer-qa', 'approved', 'meets_quality_bar'
);
select public.delete_improvement_examples_for_subject(
  '00000000-0000-0000-0000-000000000001',
  'user', 'u-020-delete',
  '02000000-0000-0000-0000-000000000001',
  'privacy_request'
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.improvement_examples
     where subject_id = 'u-020-review' and status = 'approved'
       and reviewer_id = 'reviewer-qa' and reviewed_at is not null
  ) then
    raise exception 'review decision was not recorded on the pending example';
  end if;
  if (select count(*) from public.improvement_example_review_events
       where example_id = (select id from public.improvement_examples where subject_id = 'u-020-review')) <> 1 then
    raise exception 'review audit event was not written';
  end if;
  if exists (select 1 from public.improvement_examples where subject_id = 'u-020-delete') then
    raise exception 'privacy deletion left linked examples behind';
  end if;
  if not exists (
    select 1 from public.improvement_example_deletion_events
     where request_id = '02000000-0000-0000-0000-000000000001'
       and reason_code = 'privacy_request' and deleted_count = 2
       and cardinality(deleted_example_ids) = 2
  ) then
    raise exception 'deletion lineage was not recorded without content';
  end if;
end $$;

-- No second review is allowed after the candidate leaves pending_review.
set role service_role;
do $$
begin
  begin
    perform public.review_improvement_example(
      '00000000-0000-0000-0000-000000000001',
      (select id from public.improvement_examples where subject_id = 'u-020-review'),
      'reviewer-qa', 'rejected', 'unclear'
    );
    raise exception 'a second review decision was accepted';
  exception when no_data_found then null;
  end;
end $$;
reset role;

delete from public.improvement_examples where subject_id = 'u-020-review';
delete from public.improvement_example_review_events where reviewer_id = 'reviewer-qa';
delete from public.improvement_consent_events where subject_id in ('u-020-review', 'u-020-delete');
delete from public.improvement_example_deletion_events where request_id = '02000000-0000-0000-0000-000000000001';
select 'improvement review and deletion lineage checks passed' as result;
