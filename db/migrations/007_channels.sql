-- NasrinAI channels (migration 007, Phase 6)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-006. Safe to run again.
--
-- A channel lets people reach a business's Nasrin from somewhere else, for
-- now a Facebook Page (Messenger). One row per Page: which business it
-- belongs to and the Page access token, stored only encrypted (AES-256-GCM,
-- key CONNECTOR_SECRET_KEY on the server). Only the server can read it.
-- =============================================================================

begin;

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('facebook')),
  external_id text not null check (external_id ~ '^[0-9]{5,30}$'),
  secret_enc  text not null check (char_length(secret_enc) <= 4000 and secret_enc ~ '^v1\.'),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint channels_one_owner unique (kind, external_id)
);
create index if not exists channels_tenant_idx on public.channels (tenant_id);

alter table public.channels enable row level security;
revoke all on table public.channels from anon, authenticated;
grant select, insert, update, delete on table public.channels to service_role;

commit;
