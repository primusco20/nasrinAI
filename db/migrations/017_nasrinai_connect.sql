begin;

create table if not exists public.connect_installations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_origin text not null,
  site_host text not null,
  status text not null default 'discovered'
    check (status in ('discovered','verification_required','authorized','ready','installing','active','paused','failed','removed')),
  platform text,
  installation_method text
    check (installation_method is null or installation_method in ('authorized_script','cms','hosting','repository','platform_api','managed','manual')),
  authorization_method text,
  authorization_ref text,
  verification_token_hash text,
  verification_expires_at timestamptz,
  activated_at timestamptz,
  removed_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  ai_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connect_installations_origin_check check (site_origin ~ '^https://[^/]+$'),
  constraint connect_installations_host_check check (site_host = lower(site_host))
);

create unique index if not exists connect_installations_tenant_origin_idx
  on public.connect_installations (tenant_id, site_origin);
create index if not exists connect_installations_tenant_status_idx
  on public.connect_installations (tenant_id, status);
create index if not exists connect_installations_host_idx
  on public.connect_installations (site_host);

alter table public.connect_installations enable row level security;
revoke all on table public.connect_installations from anon, authenticated;
grant select, insert, update, delete on table public.connect_installations to service_role;

commit;
