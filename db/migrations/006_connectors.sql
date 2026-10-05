-- NasrinAI connectors (migration 006, Phase 6)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-005. Safe to run again.
--
-- A connector is a business's own HTTPS API that Nasrin may call for that
-- business only. The definition (actions, their inputs, risk, who may use
-- them) is checked by the server before it is stored. The API credential is
-- stored only encrypted (AES-256-GCM, key CONNECTOR_SECRET_KEY on the server,
-- never in the database). Only the server (service role) can read the table.
-- Business secret keys need the 'connectors' scope to manage connectors.
-- =============================================================================

begin;

alter table public.api_keys drop constraint if exists api_keys_known_scopes;
alter table public.api_keys add constraint api_keys_known_scopes
  check (scopes <@ array['chat', 'connectors']::text[]);

create table if not exists public.connectors (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (name ~ '^[a-z][a-z0-9_]{1,20}$'),
  base_url    text not null check (char_length(base_url) <= 300 and base_url ~ '^https://[^/?#@:]+(/[^?#]*)?$'),
  auth_type   text not null check (auth_type in ('none', 'bearer', 'header')),
  auth_header text check (auth_header is null or auth_header ~ '^[A-Za-z0-9-]{1,40}$'),
  secret_enc  text check (secret_enc is null or (char_length(secret_enc) <= 4000 and secret_enc ~ '^v1\.')),
  actions     jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 20),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint connectors_name_per_tenant unique (tenant_id, name),
  constraint connectors_auth_has_secret check ((auth_type = 'none') = (secret_enc is null))
);

alter table public.connectors enable row level security;
revoke all on table public.connectors from anon, authenticated;
grant select, insert, update, delete on table public.connectors to service_role;

commit;
