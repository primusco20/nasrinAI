-- NasrinAI isolated improvement-example store (migration 019)
-- =============================================================================
-- Private storage foundation only. No API route or chat pipeline writes here.
-- Ingestion remains disabled until consent, redaction, eligibility, deletion,
-- review, and release gates are implemented and verified.
-- =============================================================================

begin;

create table if not exists public.improvement_examples (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  subject_type       text not null check (subject_type in ('user', 'guest')),
  subject_id         text not null check (char_length(subject_id) between 1 and 80),
  consent_version    text not null check (char_length(consent_version) between 1 and 40 and consent_version <> '2026-10-10-preference-only'),
  example_text       text not null check (char_length(example_text) between 1 and 12000),
  status             text not null default 'pending_review'
                     check (status in ('pending_review', 'approved', 'rejected', 'deleted')),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  reviewed_at        timestamptz,
  reviewer_id        text,
  deletion_reason    text
);

create index if not exists improvement_examples_expiry_idx
  on public.improvement_examples (expires_at);
create index if not exists improvement_examples_subject_idx
  on public.improvement_examples (tenant_id, subject_type, subject_id, created_at desc);

alter table public.improvement_examples enable row level security;
revoke all on table public.improvement_examples from anon, authenticated, service_role;
grant select, insert, update, delete on table public.improvement_examples to service_role;

create or replace function public.purge_improvement_examples()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- Expired examples and guest examples beyond the guest-session lifetime.
  delete from public.improvement_examples
    where expires_at <= now()
       or (subject_type = 'guest' and created_at < now() - interval '24 hours');

  -- Fail closed: remove examples unless the latest consent decision for the
  -- exact subject and version remains granted. This does not create examples.
  delete from public.improvement_examples e
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
    );
end;
$function$;

revoke execute on function public.purge_improvement_examples() from public, anon, authenticated, service_role;
grant execute on function public.purge_improvement_examples() to service_role;

commit;
