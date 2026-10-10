-- NasrinAI improvement-example human review and deletion lineage (migration 020)
-- =============================================================================
-- Adds service-role-only review decisions and content-free deletion tombstones.
-- No capture endpoint or chat ingestion is added by this migration.
-- =============================================================================

begin;

create table if not exists public.improvement_example_review_events (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  example_id   uuid not null,
  reviewer_id  text not null check (char_length(reviewer_id) between 1 and 80),
  decision     text not null check (decision in ('approved', 'rejected')),
  reason_code  text not null check (reason_code in (
    'meets_quality_bar', 'unclear', 'sensitive_content',
    'possible_identifier', 'duplicate', 'out_of_scope', 'other'
  )),
  created_at   timestamptz not null default now()
);

create index if not exists improvement_review_example_idx
  on public.improvement_example_review_events (tenant_id, example_id, created_at desc);

create table if not exists public.improvement_example_deletion_events (
  id                   bigint generated always as identity primary key,
  request_id           uuid not null,
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  reason_code          text not null check (reason_code in (
    'consent_withdrawal', 'account_deletion', 'privacy_request',
    'guest_expiry', 'retention_expiry', 'no_active_consent'
  )),
  deleted_example_ids  uuid[] not null default '{}',
  deleted_count        integer not null check (deleted_count >= 0),
  created_at           timestamptz not null default now(),
  unique (request_id, tenant_id, reason_code)
);

create index if not exists improvement_deletion_tenant_created_idx
  on public.improvement_example_deletion_events (tenant_id, created_at desc);

alter table public.improvement_example_review_events enable row level security;
alter table public.improvement_example_deletion_events enable row level security;
revoke all on table public.improvement_example_review_events from public, anon, authenticated, service_role;
revoke all on table public.improvement_example_deletion_events from public, anon, authenticated, service_role;
grant select, insert on table public.improvement_example_review_events to service_role;
grant usage on sequence public.improvement_example_review_events_id_seq to service_role;
grant select, insert on table public.improvement_example_deletion_events to service_role;
grant usage on sequence public.improvement_example_deletion_events_id_seq to service_role;

-- Only a service-role backend can request a decision. No free-text reviewer notes
-- are stored, to avoid accidentally putting personal or sensitive content in logs.
create or replace function public.review_improvement_example(
  p_tenant_id uuid,
  p_example_id uuid,
  p_reviewer_id text,
  p_decision text,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer;
begin
  if p_tenant_id is null or p_example_id is null
     or p_reviewer_id is null or char_length(trim(p_reviewer_id)) not between 1 and 80 then
    raise exception 'invalid review request' using errcode = '22023';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid review decision' using errcode = '22023';
  end if;
  if p_reason_code not in (
    'meets_quality_bar', 'unclear', 'sensitive_content',
    'possible_identifier', 'duplicate', 'out_of_scope', 'other'
  ) then
    raise exception 'invalid review reason' using errcode = '22023';
  end if;

  update public.improvement_examples e
     set status = p_decision,
         reviewed_at = now(),
         reviewer_id = trim(p_reviewer_id)
   where e.id = p_example_id
     and e.tenant_id = p_tenant_id
     and e.status = 'pending_review'
     and e.expires_at > now()
     and exists (
       select 1
         from public.improvement_consent_events c
        where c.tenant_id = e.tenant_id
          and c.subject_type = e.subject_type
          and c.subject_id = e.subject_id
          and c.version = e.consent_version
          and c.decision = 'granted'
          and c.id = (
            select c2.id
              from public.improvement_consent_events c2
             where c2.tenant_id = e.tenant_id
               and c2.subject_type = e.subject_type
               and c2.subject_id = e.subject_id
             order by c2.created_at desc, c2.id desc
             limit 1
          )
     );
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'example is missing, expired, already reviewed, or lacks active consent'
      using errcode = 'P0002';
  end if;

  insert into public.improvement_example_review_events
    (tenant_id, example_id, reviewer_id, decision, reason_code)
  values
    (p_tenant_id, p_example_id, trim(p_reviewer_id), p_decision, p_reason_code);
end;
$function$;

-- Deletes every example linked to the supplied server-verified subject. The
-- audit row retains only opaque example UUIDs, a request UUID, reason and count;
-- it never stores subject IDs or example text.
create or replace function public.delete_improvement_examples_for_subject(
  p_tenant_id uuid,
  p_subject_type text,
  p_subject_id text,
  p_request_id uuid,
  p_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_tenant_id is null or p_request_id is null
     or p_subject_type not in ('user', 'guest')
     or p_subject_id is null or char_length(p_subject_id) not between 1 and 80 then
    raise exception 'invalid deletion request' using errcode = '22023';
  end if;
  if p_reason_code not in ('consent_withdrawal', 'account_deletion', 'privacy_request') then
    raise exception 'invalid deletion reason' using errcode = '22023';
  end if;

  select coalesce(array_agg(e.id), '{}'::uuid[])
    into v_ids
    from public.improvement_examples e
   where e.tenant_id = p_tenant_id
     and e.subject_type = p_subject_type
     and e.subject_id = p_subject_id;

  delete from public.improvement_examples e
   where e.tenant_id = p_tenant_id
     and e.subject_type = p_subject_type
     and e.subject_id = p_subject_id;
  get diagnostics v_count = row_count;

  insert into public.improvement_example_deletion_events
    (request_id, tenant_id, reason_code, deleted_example_ids, deleted_count)
  values (p_request_id, p_tenant_id, p_reason_code, v_ids, v_count)
  on conflict (request_id, tenant_id, reason_code) do nothing;

  return v_count;
end;
$function$;

-- Replace the hourly purge so each deletion batch also has a content-free
-- lineage record. This is still only a scheduled cleanup; it does not ingest.
create or replace function public.purge_improvement_examples()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  r record;
  v_ids uuid[];
  v_reason text;
begin
  for r in
    select e.tenant_id,
           case when e.subject_type = 'guest' and e.created_at < now() - interval '24 hours'
                then 'guest_expiry' else 'retention_expiry' end as reason_code,
           array_agg(e.id) as ids
      from public.improvement_examples e
     where e.expires_at <= now()
        or (e.subject_type = 'guest' and e.created_at < now() - interval '24 hours')
     group by e.tenant_id, case when e.subject_type = 'guest' and e.created_at < now() - interval '24 hours'
                then 'guest_expiry' else 'retention_expiry' end
  loop
    delete from public.improvement_examples e
     where e.tenant_id = r.tenant_id and e.id = any(r.ids);
    insert into public.improvement_example_deletion_events
      (request_id, tenant_id, reason_code, deleted_example_ids, deleted_count)
    values (gen_random_uuid(), r.tenant_id, r.reason_code, r.ids, cardinality(r.ids));
  end loop;

  for r in
    select e.tenant_id, e.subject_type, e.subject_id, array_agg(e.id) as ids
      from public.improvement_examples e
     where not exists (
       select 1
         from public.improvement_consent_events c
        where c.tenant_id = e.tenant_id
          and c.subject_type = e.subject_type
          and c.subject_id = e.subject_id
          and c.version = e.consent_version
          and c.decision = 'granted'
          and c.id = (
            select c2.id
              from public.improvement_consent_events c2
             where c2.tenant_id = e.tenant_id
               and c2.subject_type = e.subject_type
               and c2.subject_id = e.subject_id
             order by c2.created_at desc, c2.id desc
             limit 1
          )
     )
     group by e.tenant_id, e.subject_type, e.subject_id
  loop
    delete from public.improvement_examples e
     where e.tenant_id = r.tenant_id
       and e.subject_type = r.subject_type
       and e.subject_id = r.subject_id;
    v_reason := 'no_active_consent';
    insert into public.improvement_example_deletion_events
      (request_id, tenant_id, reason_code, deleted_example_ids, deleted_count)
    values (gen_random_uuid(), r.tenant_id, v_reason, r.ids, cardinality(r.ids));
  end loop;
end;
$function$;

revoke execute on function public.review_improvement_example(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.delete_improvement_examples_for_subject(uuid, text, text, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.purge_improvement_examples() from public, anon, authenticated, service_role;
grant execute on function public.review_improvement_example(uuid, uuid, text, text, text) to service_role;
grant execute on function public.delete_improvement_examples_for_subject(uuid, text, text, uuid, text) to service_role;
grant execute on function public.purge_improvement_examples() to service_role;

commit;
