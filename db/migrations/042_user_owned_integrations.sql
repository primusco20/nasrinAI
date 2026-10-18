-- NasrinAI universal user-owned provider connections (migration 042).
-- Credentials are authenticated-encrypted by the server; browser roles never access this table.
begin;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id text not null check (char_length(user_id) between 1 and 200),
  provider text not null check (provider in ('vercel','render','supabase','cloudflare','github','google','facebook','slack','zoom','microsoft','other')),
  provider_account_id text not null check (char_length(provider_account_id) between 1 and 300),
  account_label text not null default '' check (char_length(account_label) <= 200),
  credential_enc text not null check (credential_enc like 'v1.%' and char_length(credential_enc) <= 20000),
  refresh_credential_enc text check (refresh_credential_enc is null or (refresh_credential_enc like 'v1.%' and char_length(refresh_credential_enc) <= 20000)),
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','needs_attention','revoked','disconnected')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, provider, provider_account_id)
);

create index if not exists integration_connections_owner_idx
  on public.integration_connections (tenant_id, user_id, provider, status);

create table if not exists public.integration_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  tenant_id uuid not null,
  user_id text not null check (char_length(user_id) between 1 and 200),
  provider text not null check (provider in ('vercel','render','supabase','cloudflare','github','google','facebook','slack','zoom','microsoft','other')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists integration_oauth_states_expiry_idx on public.integration_oauth_states (expires_at);

do $migration$
begin
  execute 'REVOKE ALL PRIVILEGES ON TABLE public.integration_connections FROM PUBLIC, anon, authenticated';
  execute 'REVOKE ALL PRIVILEGES ON TABLE public.integration_oauth_states FROM PUBLIC, anon, authenticated';
  execute 'ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY';
  execute 'ALTER TABLE public.integration_oauth_states ENABLE ROW LEVEL SECURITY';
  execute 'DROP POLICY IF EXISTS server_only_deny_browser ON public.integration_connections';
  execute 'CREATE POLICY server_only_deny_browser ON public.integration_connections FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  execute 'DROP POLICY IF EXISTS server_only_deny_browser ON public.integration_oauth_states';
  execute 'CREATE POLICY server_only_deny_browser ON public.integration_oauth_states FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
end
$migration$;

commit;
