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


-- Guest consent is short-lived like the guest session. Signed-in consent
-- evidence is retained for a bounded 10 years; no conversation content exists
-- in this table.
create or replace function public.purge_improvement_consent()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  delete from public.improvement_consent_events
    where subject_type = 'guest' and created_at < now() - interval '24 hours';
  delete from public.improvement_consent_events
    where subject_type = 'user' and created_at < now() - interval '10 years';
end;
$function$;

revoke execute on function public.purge_improvement_consent() from public, anon, authenticated, service_role;
grant execute on function public.purge_improvement_consent() to service_role;

commit;
