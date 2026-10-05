-- NasrinAI legal acceptance and account deletion (migration 005)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-004. Safe to run again.
--
-- legal_acceptances: proof that a signed-in user accepted a Terms version (and
-- was shown a Privacy Notice version). Insert-only for the server, so records
-- cannot be edited or removed by the application.
-- delete_user_data: what "Delete my account" removes. See docs/compliance.
-- =============================================================================

begin;

create table if not exists public.legal_acceptances (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    text not null check (char_length(user_id) between 1 and 80),
  document   text not null check (document in ('terms', 'privacy')),
  version    text not null check (char_length(version) between 1 and 40),
  action     text not null check (action in ('accepted', 'acknowledged')),
  method     text not null check (method in ('signin', 'update_prompt')),
  created_at timestamptz not null default now()
);
create index if not exists legal_acceptances_user_idx on public.legal_acceptances (tenant_id, user_id, document, version);

-- Removes a user's content and identifiers from NasrinAI's tables:
--   conversations, messages and pictures      deleted
--   usage records                             kept as numbers, user id replaced
--   plan payments and legal acceptances       kept (payment and legal records),
--                                             see the retention schedule
create or replace function public.delete_user_data(p_tenant uuid, p_user text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversations where tenant_id = p_tenant and owner_type = 'user' and owner_id = p_user;
  update public.usage_events set actor_id = 'deleted-user' where tenant_id = p_tenant and actor_type = 'user' and actor_id = p_user;
end;
$$;

alter table public.legal_acceptances enable row level security;
revoke all on table public.legal_acceptances from anon, authenticated, service_role;
grant select, insert on table public.legal_acceptances to service_role;
grant usage on sequence public.legal_acceptances_id_seq to service_role;

revoke execute on function public.delete_user_data(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.delete_user_data(uuid, text) to service_role;

commit;
