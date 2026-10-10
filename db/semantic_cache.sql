-- Semantic cache for AI answers. Run once in the Supabase SQL editor.
-- 384 dimensions = Xenova/all-MiniLM-L6-v2. If you change the model, change
-- the dimension here and bump EMBED_MODEL: rows from other models are ignored.

create extension if not exists vector;

create table if not exists semantic_cache (
  id              uuid primary key default gen_random_uuid(),
  scope           text not null,                 -- user or tenant id: a cache hit never crosses scopes
  prompt          text not null,
  response        text not null,
  embedding       vector(384) not null,
  embedding_model text not null,
  hit_count       int  not null default 0,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 days'
);

create index if not exists semantic_cache_embedding_idx
  on semantic_cache using hnsw (embedding vector_cosine_ops);
create index if not exists semantic_cache_scope_idx on semantic_cache (scope);

-- Only the server (service-role key) may touch this table: RLS on, no policies.
alter table semantic_cache enable row level security;
revoke all on table public.semantic_cache from public, anon, authenticated;

-- Closest stored prompt above the threshold, same scope and model, not expired.
create or replace function public.match_semantic_cache(
  query_embedding vector(384),
  match_scope     text,
  match_model     text,
  match_threshold float,
  match_count     int default 1
)
returns table (id uuid, prompt text, response text, similarity float)
language sql stable
set search_path = pg_catalog, public
as $$
  select c.id, c.prompt, c.response,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.semantic_cache c
  where c.scope = match_scope
    and c.embedding_model = match_model
    and c.expires_at > now()
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.touch_semantic_cache(cache_id uuid)
returns void language sql
set search_path = pg_catalog, public
as $$ update public.semantic_cache set hit_count = hit_count + 1 where id = cache_id; $$;

revoke all on function public.match_semantic_cache(vector, text, text, double precision, integer) from public, anon, authenticated;
revoke all on function public.touch_semantic_cache(uuid) from public, anon, authenticated;
