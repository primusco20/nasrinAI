-- Checks for migration 019 (configuration approval columns). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'connect_installations'
     and column_name in ('config_approved_at', 'config_approved_by', 'config_approval_hash');
  if n <> 3 then raise exception 'expected 3 approval columns, found %', n; end if;
  if to_regclass('public.connect_installations_approval_idx') is null then
    raise exception 'approval index is missing';
  end if;
end $$;

-- A new site starts with no approval.
set role service_role;
do $$
declare r record;
begin
  insert into public.connect_installations (tenant_id, site_origin, site_host)
  values ('00000000-0000-0000-0000-000000000001', 'https://shop019.example.com', 'shop019.example.com');
  select config_approved_at, config_approved_by, config_approval_hash into r
    from public.connect_installations where site_host = 'shop019.example.com';
  if r.config_approved_at is not null or r.config_approved_by is not null or r.config_approval_hash is not null then
    raise exception 'a new site started out approved';
  end if;
  delete from public.connect_installations where site_host = 'shop019.example.com';
end $$;
reset role;
select 'connect approval checks passed' as result;
