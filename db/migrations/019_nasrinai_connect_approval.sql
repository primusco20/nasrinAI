begin;

alter table public.connect_installations
  add column if not exists config_approved_at timestamptz,
  add column if not exists config_approved_by uuid,
  add column if not exists config_approval_hash text;

create index if not exists connect_installations_approval_idx
  on public.connect_installations (tenant_id, config_approved_at);

commit;
