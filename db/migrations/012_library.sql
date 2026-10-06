-- NasrinAI Library (migration 012)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-011. Safe to run again.
--
-- A signed-in person's own documents: text files they add, notes they write,
-- and replies they save. Only the text is kept (no original files), split into
-- chunks for full-text search ('simple' config, no AI call). Every row carries
-- the owner; the server always filters by tenant AND user. Deleted with the
-- person's account (delete_user_data). Only the server (service role) can
-- read these tables.
-- =============================================================================

begin;

create table if not exists public.library_files (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  title       text not null check (char_length(title) between 1 and 120),
  kind        text not null check (kind in ('file', 'note', 'reply')),
  format      text not null check (format in ('text', 'markdown', 'csv', 'json')),
  chars       integer not null check (chars between 1 and 200000),
  created_at  timestamptz not null default now()
);
create index if not exists library_files_user_idx on public.library_files (tenant_id, user_id, created_at desc);

create table if not exists public.library_chunks (
  id         bigserial primary key,
  file_id    uuid not null references public.library_files(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  idx        integer not null check (idx between 0 and 1000),
  text       text not null check (char_length(text) between 1 and 2400),
  tsv        tsvector generated always as (to_tsvector('simple', text)) stored,
  unique (file_id, idx)
);
create index if not exists library_chunks_tsv_idx on public.library_chunks using gin (tsv);
create index if not exists library_chunks_user_idx on public.library_chunks (tenant_id, user_id);

-- p_terms: words joined with ' | ' (the server keeps only letters and digits).
create or replace function public.search_library(p_tenant uuid, p_user text, p_terms text, p_limit integer)
returns table (file_id uuid, title text, idx integer, text text, rank real)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.file_id, f.title, c.idx, c.text, ts_rank_cd(c.tsv, q, 32) as rank
  from public.library_chunks c
  join public.library_files f on f.id = c.file_id
  cross join to_tsquery('simple', p_terms) q
  where c.tenant_id = p_tenant and c.user_id = p_user
    and f.tenant_id = p_tenant and f.user_id = p_user
    and c.tsv @@ q
  order by rank desc
  limit least(greatest(p_limit, 1), 10);
$$;

-- Account deletion now also removes the person's Library.
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
  update public.usage_events set actor_id = 'deleted-user' where tenant_id = p_tenant and actor_type = 'user' and actor_id = p_user;
end;
$$;

alter table public.library_files enable row level security;
alter table public.library_chunks enable row level security;
revoke all on table public.library_files, public.library_chunks from anon, authenticated, service_role;
grant select, insert, delete on table public.library_files, public.library_chunks to service_role;
grant usage on sequence public.library_chunks_id_seq to service_role;
revoke execute on function public.search_library(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_library(uuid, text, text, integer) to service_role;
revoke execute on function public.delete_user_data(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.delete_user_data(uuid, text) to service_role;

commit;
