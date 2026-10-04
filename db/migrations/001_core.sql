-- NasrinAI core schema (migration 001)
-- =============================================================================
-- Run once in the Supabase SQL editor of the NasrinAI project. Safe to run again.
--
-- Access rule for every table here: only the NasrinAI server, using the
-- service-role key, can read or write. RLS is on with no policies, and the
-- browser roles (anon, authenticated) get no table grants at all.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Tenants: one row per business, plus the NasrinAI platform itself.
-- -----------------------------------------------------------------------------
create table if not exists public.tenants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 120),
  kind              text not null default 'business' check (kind in ('platform', 'business')),
  status            text not null default 'active' check (status in ('active', 'suspended')),
  daily_token_limit bigint not null default 1000000 check (daily_token_limit >= 0),
  created_at        timestamptz not null default now()
);

-- The standalone NasrinAI chat (signed-in users and guests) belongs here.
-- The server uses this fixed id.
insert into public.tenants (id, name, kind, daily_token_limit)
values ('00000000-0000-0000-0000-000000000001', 'NasrinAI', 'platform', 2000000)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- API keys for businesses.
--   publishable: nsp_<id>            public, for a website widget, origin-locked
--   secret:      nss_<id>_<secret>   server-to-server; only a SHA-256 hash is kept
-- -----------------------------------------------------------------------------
create table if not exists public.api_keys (
  id              text primary key check (id ~ '^[0-9a-f]{12}$'),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  kind            text not null check (kind in ('publishable', 'secret')),
  label           text not null default '' check (char_length(label) <= 80),
  secret_hash     text check (secret_hash is null or secret_hash ~ '^[0-9a-f]{64}$'),
  scopes          text[] not null default array['chat']::text[],
  allowed_origins text[] not null default '{}'::text[],
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint api_keys_secret_has_hash check ((kind = 'secret') = (secret_hash is not null)),
  constraint api_keys_publishable_has_origins check (kind <> 'publishable' or cardinality(allowed_origins) > 0),
  constraint api_keys_known_scopes check (scopes <@ array['chat']::text[])
);
create index if not exists api_keys_tenant_idx on public.api_keys (tenant_id);

-- -----------------------------------------------------------------------------
-- Conversations and messages: history lives here, never in the browser.
-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  owner_type text not null check (owner_type in ('user', 'guest', 'service')),
  owner_id   text not null check (char_length(owner_id) between 1 and 80),
  title      text not null default '' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint conversations_id_tenant_unique unique (id, tenant_id)
);
create index if not exists conversations_owner_idx
  on public.conversations (tenant_id, owner_type, owner_id, updated_at desc);
create index if not exists conversations_expires_idx
  on public.conversations (expires_at) where expires_at is not null;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  tenant_id       uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) between 1 and 20000),
  created_at      timestamptz not null default now(),
  -- a message can only belong to a conversation of the same tenant
  constraint messages_conversation_fk foreign key (conversation_id, tenant_id)
    references public.conversations (id, tenant_id) on delete cascade
);
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);

create or replace function public.touch_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();

-- -----------------------------------------------------------------------------
-- Shared rate limits: one counter per (bucket, fixed time window).
-- Every server instance counts in the same place (fixes audit finding M2).
-- -----------------------------------------------------------------------------
create table if not exists public.rate_counters (
  bucket       text not null check (char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_counters_window_idx on public.rate_counters (window_start);

-- Counts one hit and says whether it is within the limit. Atomic, so two
-- requests at the same moment cannot both slip under it.
create or replace function public.rate_hit(p_bucket text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, used integer, retry_after integer)
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_hits  integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400
     or p_limit is null or p_limit < 0 or p_bucket is null then
    raise exception 'rate_hit: invalid arguments';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_counters as rc (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = rc.hits + 1
  returning rc.hits into v_hits;

  allowed := v_hits <= p_limit;
  used := v_hits;
  retry_after := greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::integer);
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Usage: one row per model call. No message text is stored here (fixes M6).
-- -----------------------------------------------------------------------------
create table if not exists public.usage_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  actor_type    text not null check (actor_type in ('user', 'guest', 'service')),
  actor_id      text not null check (char_length(actor_id) between 1 and 80),
  provider      text not null check (char_length(provider) between 1 and 40),
  model         text not null check (char_length(model) between 1 and 80),
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  latency_ms    integer not null default 0 check (latency_ms >= 0),
  outcome       text not null check (outcome in ('ok', 'provider_error', 'timeout', 'rejected_output')),
  created_at    timestamptz not null default now()
);
create index if not exists usage_events_tenant_time_idx on public.usage_events (tenant_id, created_at);
create index if not exists usage_events_actor_time_idx on public.usage_events (actor_type, actor_id, created_at);

-- Tokens used since a moment, optionally narrowed to a tenant and/or actor.
create or replace function public.usage_tokens_since(
  p_since timestamptz,
  p_tenant uuid default null,
  p_actor_type text default null,
  p_actor_id text default null
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from public.usage_events
  where created_at >= p_since
    and (p_tenant is null or tenant_id = p_tenant)
    and (p_actor_type is null or actor_type = p_actor_type)
    and (p_actor_id is null or actor_id = p_actor_id);
$$;

-- Deletes expired guest conversations and old rate counters.
create or replace function public.purge_expired()
returns void
language sql
set search_path = ''
as $$
  delete from public.conversations where expires_at is not null and expires_at < now();
  delete from public.rate_counters where window_start < now() - interval '2 days';
$$;

-- -----------------------------------------------------------------------------
-- Key management: run these by hand in the SQL editor. The server cannot.
-- -----------------------------------------------------------------------------

-- Creates a key and returns it ONCE. For a secret key only the hash is stored,
-- so copy the returned value straight into the business's server settings.
create or replace function public.create_api_key(
  p_tenant  uuid,
  p_kind    text,
  p_label   text default '',
  p_origins text[] default '{}'::text[],
  p_scopes  text[] default array['chat']::text[]
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id      text := encode(extensions.gen_random_bytes(6), 'hex');
  v_secret  text;
  v_origins text[];
begin
  if p_kind not in ('publishable', 'secret') then
    raise exception 'kind must be publishable or secret';
  end if;
  select coalesce(array_agg(lower(rtrim(o, '/'))), '{}'::text[]) into v_origins from unnest(p_origins) as o;
  if exists (select 1 from unnest(v_origins) as o where o !~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$') then
    raise exception 'each origin must look like https://example.com';
  end if;

  if p_kind = 'publishable' then
    insert into public.api_keys (id, tenant_id, kind, label, scopes, allowed_origins)
    values (v_id, p_tenant, 'publishable', coalesce(p_label, ''), p_scopes, v_origins);
    return 'nsp_' || v_id;
  end if;

  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (id, tenant_id, kind, label, secret_hash, scopes, allowed_origins)
  values (v_id, p_tenant, 'secret', coalesce(p_label, ''),
          encode(extensions.digest(v_secret, 'sha256'), 'hex'), p_scopes, v_origins);
  return 'nss_' || v_id || '_' || v_secret;
end;
$$;

create or replace function public.revoke_api_key(p_id text)
returns void
language sql
set search_path = ''
as $$
  update public.api_keys set revoked_at = now() where id = p_id and revoked_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Lock everything down.
-- -----------------------------------------------------------------------------
alter table public.tenants       enable row level security;
alter table public.api_keys      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.rate_counters enable row level security;
alter table public.usage_events  enable row level security;

revoke all on table public.tenants, public.api_keys, public.conversations,
                    public.messages, public.rate_counters, public.usage_events
  from anon, authenticated;
grant select, insert, update, delete on table public.tenants, public.api_keys, public.conversations,
                    public.messages, public.rate_counters, public.usage_events
  to service_role;
grant usage on sequence public.usage_events_id_seq to service_role;

revoke execute on function public.rate_hit(text, integer, integer),
                           public.usage_tokens_since(timestamptz, uuid, text, text),
                           public.purge_expired(),
                           public.touch_conversation(),
                           public.create_api_key(uuid, text, text, text[], text[]),
                           public.revoke_api_key(text)
  from public, anon, authenticated, service_role;
grant execute on function public.rate_hit(text, integer, integer),
                          public.usage_tokens_since(timestamptz, uuid, text, text),
                          public.purge_expired()
  to service_role;

commit;
