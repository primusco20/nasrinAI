-- NasrinAI security boundary hardening (migration 022)
-- All application data in public is server-only. Keep RLS enabled and prevent
-- browser API roles from receiving direct table/view/sequence privileges.
-- This deliberately creates no permissive RLS policies: the backend uses the
-- service_role key and performs tenant/owner authorization in the server.
-- Safe to run repeatedly.

begin;

do $$
declare
  r record;
begin
  -- RLS on every ordinary or partitioned application table.
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
  end loop;

  -- No direct browser access to any public relation, including views and
  -- foreign tables. The backend's explicit service_role grants are untouched.
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke all privileges on table %I.%I from anon, authenticated', r.nspname, r.relname);
  end loop;

  -- Sequences can otherwise provide a side door to direct writes.
  revoke all privileges on all sequences in schema public from anon, authenticated;
end
$$;

-- Supabase commonly grants broad default privileges. Remove browser-role
-- defaults for objects created later by the role running this migration.
alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public
  revoke all privileges on sequences from anon, authenticated;

commit;
