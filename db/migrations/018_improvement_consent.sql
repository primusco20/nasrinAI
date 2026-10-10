-- NasrinAI improvement consent evidence (migration 018)
-- =============================================================================
-- Records a separate, optional improvement-use choice only. It does not store
-- conversation text or enable any collection pipeline. Events are append-only.
-- =============================================================================

begin;

create table if not exists public.improvement_consent_events (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  subject_type text not null check (subject_type in ('user', 'guest')),
  subject_id   text not null check (char_length(subject_id) between 1 and 80),
  version      text not null check (char_length(version) between 1 and 40),
  decision     text not null check (decision in ('granted', 'declined', 'withdrawn')),
  created_at   timestamptz not null default now()
);

create index if not exists improvement_consent_subject_idx
  on public.improvement_consent_events (tenant_id, subject_type, subject_id, created_at desc, id desc);

alter table public.improvement_consent_events enable row level security;
revoke all on table public.improvement_consent_events from anon, authenticated, service_role;
grant select, insert on table public.improvement_consent_events to service_role;
grant usage on sequence public.improvement_consent_events_id_seq to service_role;

commit;
