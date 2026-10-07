-- NasrinAI Storage (migration 014)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-013. Safe to run again.
--
-- The Library is now a storage of the signed-in person's data. This adds the
-- one thing that was not kept before: photos and files they send in a chat.
-- Bytes are private (service role only), owned by one person, and deleted
-- with their chat, their account, or when their chosen keep-time passes.
--
-- purge_user_data_before: deletes one person's chats, files, notes, saved
-- replies, sent files and generated pictures older than a moment (their
-- "keep my data for" choice); with p_images_only, only the pictures. Only the
-- server (service role) can call it.
-- =============================================================================

begin;

create table if not exists public.sent_files (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  conversation_id uuid references public.conversations(id) on delete cascade,
  kind            text not null check (kind in ('photo', 'file')),
  name            text not null check (char_length(name) between 1 and 120),
  mime            text not null check (char_length(mime) between 1 and 100),
  size            integer not null check (size between 1 and 8000000),
  bytes           bytea not null check (octet_length(bytes) between 1 and 8000000),
  created_at      timestamptz not null default now()
);
create index if not exists sent_files_user_idx on public.sent_files (tenant_id, user_id, created_at desc);
create index if not exists sent_files_conversation_idx on public.sent_files (conversation_id);

create or replace function public.purge_user_data_before(p_tenant uuid, p_user text, p_before timestamptz, p_images_only boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not p_images_only then
    delete from public.conversations where tenant_id = p_tenant and owner_type = 'user' and owner_id = p_user and updated_at < p_before;
    delete from public.library_files where tenant_id = p_tenant and user_id = p_user and created_at < p_before;
    delete from public.sent_files where tenant_id = p_tenant and user_id = p_user and created_at < p_before;
  end if;
  delete from public.generated_images where tenant_id = p_tenant and owner_type = 'user' and owner_id = p_user and created_at < p_before;
end;
$$;

-- Account deletion also removes sent files (they go with the person's chats;
-- this also catches any not tied to a chat).
create or replace function public.delete_user_data(p_tenant uuid, p_user text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversations where tenant_id = p_tenant and owner_type = 'user' and owner_id = p_user;
  delete from public.user_memories where tenant_id = p_tenant and user_id = p_user;
  delete from public.library_files where tenant_id = p_tenant and user_id = p_user;
  delete from public.sent_files where tenant_id = p_tenant and user_id = p_user;
  delete from public.projects where tenant_id = p_tenant and user_id = p_user;
  update public.usage_events set actor_id = 'deleted-user' where tenant_id = p_tenant and actor_type = 'user' and actor_id = p_user;
end;
$$;

alter table public.sent_files enable row level security;
revoke all on table public.sent_files from anon, authenticated, service_role;
grant select, insert, delete on table public.sent_files to service_role;
revoke execute on function public.purge_user_data_before(uuid, text, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.purge_user_data_before(uuid, text, timestamptz, boolean) to service_role;
revoke execute on function public.delete_user_data(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.delete_user_data(uuid, text) to service_role;

commit;
