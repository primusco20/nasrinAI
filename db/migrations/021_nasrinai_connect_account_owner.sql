begin;

-- NasrinAI Connect ownership is per signed-in business account, not merely
-- the platform tenant. Normal signed-in users share the platform tenant,
-- so tenant_id alone is not an ownership boundary for Connect.
alter table public.connect_installations
  add column if not exists owner_user_id text;

alter table public.connect_installations
  drop constraint if exists connect_installations_owner_user_id_check;

alter table public.connect_installations
  add constraint connect_installations_owner_user_id_check
  check (
    owner_user_id is null
    or owner_user_id ~ '^[A-Za-z0-9_-]{1,80}create index if not exists connect_installations_owner_idx
  on public.connect_installations (tenant_id, owner_user_id, status);

-- New installations are unique per owning account and website.
create unique index if not exists connect_installations_owner_origin_idx
  on public.connect_installations (tenant_id, owner_user_id, site_origin)
  where owner_user_id is not null;

commit;

  );

-- Existing approved installations have the approving account recorded already.
-- Use that server-recorded identity for a safe ownership backfill. Installations
-- that were never approved remain unassigned and are intentionally not exposed.
update public.connect_installations
set owner_user_id = config_approved_by::text
where owner_user_id is null
  and config_approved_by is not null;

create index if not exists connect_installations_owner_idx
  on public.connect_installations (tenant_id, owner_user_id, status);

-- New installations are unique per owning account and website.
create unique index if not exists connect_installations_owner_origin_idx
  on public.connect_installations (tenant_id, owner_user_id, site_origin)
  where owner_user_id is not null;

commit;
