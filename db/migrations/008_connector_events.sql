-- NasrinAI connector events (migration 008, Phase 6)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-007. Safe to run again.
--
-- A business's system (a POS, a shop) can push events to NasrinAI through a
-- signed webhook: order ready, stock changed, and so on. Nasrin can then
-- answer from the latest events. The webhook secret is stored only encrypted
-- (key CONNECTOR_SECRET_KEY on the server). Events older than 30 days are
-- removed by the server. Only the server (service role) can read them.
-- =============================================================================

begin;

alter table public.connectors add column if not exists webhook_secret_enc text
  check (webhook_secret_enc is null or (char_length(webhook_secret_enc) <= 4000 and webhook_secret_enc ~ '^v1\.'));
alter table public.connectors add column if not exists events_who text[] not null default array['service']::text[];
alter table public.connectors drop constraint if exists connectors_events_who_known;
alter table public.connectors add constraint connectors_events_who_known
  check (cardinality(events_who) between 1 and 2 and events_who <@ array['service', 'guest']::text[]);

create table if not exists public.connector_events (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  connector   text not null check (connector ~ '^[a-z][a-z0-9_]{1,20}$'),
  event_id    text not null check (event_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  type        text not null check (type ~ '^[a-z0-9_.]{1,60}$'),
  key         text check (key is null or char_length(key) <= 100),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 8192),
  created_at  timestamptz not null default now(),
  constraint connector_events_once unique (tenant_id, connector, event_id)
);
create index if not exists connector_events_lookup_idx on public.connector_events (tenant_id, connector, created_at desc);
create index if not exists connector_events_key_idx on public.connector_events (tenant_id, connector, key, created_at desc);

alter table public.connector_events enable row level security;
revoke all on table public.connector_events from anon, authenticated, service_role;
grant select, insert, delete on table public.connector_events to service_role;
grant usage on sequence public.connector_events_id_seq to service_role;

commit;
