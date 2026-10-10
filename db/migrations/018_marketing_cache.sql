-- Owner-isolated cache for reusable marketing briefs and exact creative outputs.
-- Cache records contain fingerprints and small JSON metadata only; media bytes stay
-- in the existing owner-scoped generated_images/generated_videos tables.
begin;

create table if not exists public.marketing_cache (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  owner_type  text not null check (owner_type in ('user','guest','service')),
  owner_id    text not null check (owner_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  kind        text not null check (kind in ('image','video','brief')),
  cache_key   char(64) not null check (cache_key ~ '^[0-9a-f]{64}$'),
  value       jsonb not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, owner_type, owner_id, kind, cache_key)
);

create index if not exists marketing_cache_expiry_idx
  on public.marketing_cache (expires_at);

alter table public.marketing_cache enable row level security;
revoke all on public.marketing_cache from anon, authenticated, service_role;
grant select, insert, update, delete on public.marketing_cache to service_role;

commit;
