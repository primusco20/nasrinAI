-- NasrinAI knowledge and memory (migration 009, Phase 7)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-008. Safe to run again.
--
-- Knowledge: a business's own documents (menu, FAQ, policies), split into
-- chunks and searched with Postgres full-text search ('simple' config, so it
-- works for English, Filipino and Bisaya alike; no AI call, no cost). Each
-- document says who may see it: 'service', 'guest' and/or 'user'.
-- Memory: short notes a signed-in person asked Nasrin to remember (each one
-- confirmed by them). Deleted with their account (delete_user_data).
-- Only the server (service role) can read either.
-- =============================================================================

begin;

alter table public.api_keys drop constraint if exists api_keys_known_scopes;
alter table public.api_keys add constraint api_keys_known_scopes
  check (scopes <@ array['chat', 'connectors', 'knowledge']::text[]);

create table if not exists public.knowledge_docs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  source_url  text check (source_url is null or (char_length(source_url) <= 500 and source_url ~ '^https?://')),
  who         text[] not null default array['service', 'guest', 'user']::text[]
              check (cardinality(who) between 1 and 3 and who <@ array['service', 'guest', 'user']::text[]),
  chars       integer not null check (chars between 1 and 200000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists knowledge_docs_tenant_idx on public.knowledge_docs (tenant_id);

create table if not exists public.knowledge_chunks (
  id        bigserial primary key,
  doc_id    uuid not null references public.knowledge_docs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idx       integer not null check (idx between 0 and 1000),
  text      text not null check (char_length(text) between 1 and 2400),
  tsv       tsvector generated always as (to_tsvector('simple', text)) stored
);
create index if not exists knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (tsv);
create index if not exists knowledge_chunks_tenant_idx on public.knowledge_chunks (tenant_id);

-- p_terms: words joined with ' | ' (the server keeps only letters and digits).
create or replace function public.search_knowledge(p_tenant uuid, p_terms text, p_audience text, p_limit integer)
returns table (doc_id uuid, title text, source_url text, idx integer, text text, rank real)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.doc_id, d.title, d.source_url, c.idx, c.text, ts_rank_cd(c.tsv, q, 32) as rank
  from public.knowledge_chunks c
  join public.knowledge_docs d on d.id = c.doc_id
  cross join to_tsquery('simple', p_terms) q
  where c.tenant_id = p_tenant and d.tenant_id = p_tenant
    and p_audience = any(d.who)
    and c.tsv @@ q
  order by rank desc
  limit least(greatest(p_limit, 1), 10);
$$;

create table if not exists public.user_memories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  text       text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists user_memories_user_idx on public.user_memories (tenant_id, user_id, created_at desc);

-- Account deletion now also removes the person's memories.
create or replace function public.delete_user_data(p_tenant uuid, p_user text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversations where tenant_id = p_tenant and owner_type = 'user' and owner_id = p_user;
  delete from public.user_memories where tenant_id = p_tenant and user_id = p_user;
  update public.usage_events set actor_id = 'deleted-user' where tenant_id = p_tenant and actor_type = 'user' and actor_id = p_user;
end;
$$;

alter table public.knowledge_docs enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.user_memories enable row level security;
revoke all on table public.knowledge_docs, public.knowledge_chunks, public.user_memories from anon, authenticated, service_role;
grant select, insert, delete on table public.knowledge_docs, public.knowledge_chunks, public.user_memories to service_role;
grant usage on sequence public.knowledge_chunks_id_seq to service_role;
revoke execute on function public.search_knowledge(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_knowledge(uuid, text, text, integer) to service_role;
revoke execute on function public.delete_user_data(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.delete_user_data(uuid, text) to service_role;

commit;
