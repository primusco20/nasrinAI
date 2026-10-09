-- NasrinAI atomic daily token reservations (migration 015)
-- =============================================================================
-- Run after migrations 001-014. Safe to run again.
--
-- This ledger closes the race in preflight-only token checks. Reservations are
-- held in PostgreSQL so all server instances share the same quota decision.
-- The service role is the only caller; no browser role receives table access.
-- =============================================================================

begin;

create table if not exists public.daily_token_reservations (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  actor_type      text not null check (actor_type in ('user', 'guest', 'service')),
  actor_id        text not null check (char_length(actor_id) between 1 and 80),
  day_start       timestamptz not null,
  reserved_tokens bigint not null check (reserved_tokens > 0),
  actual_tokens   bigint check (actual_tokens is null or actual_tokens >= 0),
  status          text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  check ((status = 'reserved' and actual_tokens is null and settled_at is null)
      or (status = 'settled' and actual_tokens is not null and settled_at is not null)
      or (status = 'released' and actual_tokens is null and settled_at is not null))
);

create index if not exists daily_token_reservations_tenant_day_idx
  on public.daily_token_reservations (tenant_id, day_start, status);
create index if not exists daily_token_reservations_actor_day_idx
  on public.daily_token_reservations (tenant_id, actor_type, actor_id, day_start, status);

alter table public.usage_events
  add column if not exists reservation_id uuid
  references public.daily_token_reservations(id) on delete set null;
create index if not exists usage_events_reservation_idx
  on public.usage_events (reservation_id) where reservation_id is not null;

alter table public.daily_token_reservations enable row level security;
revoke all on table public.daily_token_reservations from public, anon, authenticated;
grant select, insert, update, delete on table public.daily_token_reservations to service_role;

-- Reserve atomically. The tenant advisory lock serializes reservations that
-- compete for either the same actor allowance or the tenant ceiling.
create or replace function public.reserve_daily_tokens(
  p_reservation_id uuid,
  p_tenant uuid,
  p_actor_type text,
  p_actor_id text,
  p_reserved_tokens bigint,
  p_actor_limit bigint,
  p_guest_limit bigint,
  p_tenant_limit bigint
)
returns table (allowed boolean, reason text, reservation_id uuid, actor_used bigint, tenant_used bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz;
  v_legacy_tenant bigint;
  v_reserved_tenant bigint;
  v_legacy_actor bigint;
  v_reserved_actor bigint;
  v_actor_limit bigint;
begin
  if p_reservation_id is null or p_tenant is null
     or p_actor_type not in ('user', 'guest', 'service')
     or p_actor_id is null or char_length(p_actor_id) < 1 or char_length(p_actor_id) > 80
     or p_reserved_tokens is null or p_reserved_tokens < 1 or p_reserved_tokens > 10000000
     or p_tenant_limit is null or p_tenant_limit < 0
     or p_actor_limit is null or p_actor_limit < 0
     or p_guest_limit is null or p_guest_limit < 0 then
    raise exception 'reserve_daily_tokens: invalid arguments';
  end if;

  v_day_start := date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant::text, 0));

  if exists (select 1 from public.daily_token_reservations r where r.id = p_reservation_id) then
    return query select false, 'duplicate_reservation'::text, p_reservation_id, 0::bigint, 0::bigint;
    return;
  end if;

  select coalesce(sum(e.input_tokens + e.output_tokens), 0)::bigint
    into v_legacy_tenant
    from public.usage_events e
   where e.tenant_id = p_tenant and e.created_at >= v_day_start and e.reservation_id is null;

  select coalesce(sum(case when r.status = 'reserved' then r.reserved_tokens
                           when r.status = 'settled' then r.actual_tokens
                           else 0 end), 0)::bigint
    into v_reserved_tenant
    from public.daily_token_reservations r
   where r.tenant_id = p_tenant and r.day_start = v_day_start and r.status in ('reserved', 'settled');

  tenant_used := v_legacy_tenant + v_reserved_tenant;
  actor_used := 0;
  v_actor_limit := null;

  if p_actor_type = 'user' then
    v_actor_limit := p_actor_limit;
    select coalesce(sum(e.input_tokens + e.output_tokens), 0)::bigint
      into v_legacy_actor
      from public.usage_events e
     where e.tenant_id = p_tenant and e.actor_type = 'user' and e.actor_id = p_actor_id
       and e.created_at >= v_day_start and e.reservation_id is null;
    select coalesce(sum(case when r.status = 'reserved' then r.reserved_tokens
                             when r.status = 'settled' then r.actual_tokens
                             else 0 end), 0)::bigint
      into v_reserved_actor
      from public.daily_token_reservations r
     where r.tenant_id = p_tenant and r.actor_type = 'user' and r.actor_id = p_actor_id
       and r.day_start = v_day_start and r.status in ('reserved', 'settled');
    actor_used := v_legacy_actor + v_reserved_actor;
  elsif p_actor_type = 'guest' and p_tenant = '00000000-0000-0000-0000-000000000001'::uuid then
    -- The platform guest ceiling is shared across all platform guests.
    v_actor_limit := p_guest_limit;
    select coalesce(sum(e.input_tokens + e.output_tokens), 0)::bigint
      into v_legacy_actor
      from public.usage_events e
     where e.tenant_id = p_tenant and e.actor_type = 'guest'
       and e.created_at >= v_day_start and e.reservation_id is null;
    select coalesce(sum(case when r.status = 'reserved' then r.reserved_tokens
                             when r.status = 'settled' then r.actual_tokens
                             else 0 end), 0)::bigint
      into v_reserved_actor
      from public.daily_token_reservations r
     where r.tenant_id = p_tenant and r.actor_type = 'guest'
       and r.day_start = v_day_start and r.status in ('reserved', 'settled');
    actor_used := v_legacy_actor + v_reserved_actor;
  end if;

  if v_actor_limit is not null and actor_used + p_reserved_tokens > v_actor_limit then
    return query select false, case when p_actor_type = 'guest' then 'guest_limit' else 'daily_limit' end,
      null::uuid, actor_used, tenant_used;
    return;
  end if;

  if tenant_used + p_reserved_tokens > p_tenant_limit then
    return query select false, 'tenant_limit'::text, null::uuid, actor_used, tenant_used;
    return;
  end if;

  insert into public.daily_token_reservations
    (id, tenant_id, actor_type, actor_id, day_start, reserved_tokens)
  values
    (p_reservation_id, p_tenant, p_actor_type, p_actor_id, v_day_start, p_reserved_tokens);

  return query select true, null::text, p_reservation_id, actor_used, tenant_used;
end;
$$;

-- Reconcile exactly once. Repeating settlement is safe; released reservations
-- cannot be resurrected. If actual usage exceeds the estimate, record the real
-- amount so subsequent calls see it and stop rather than silently undercount.
create or replace function public.settle_daily_token_reservation(p_reservation_id uuid, p_actual_tokens bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_reservation_id is null or p_actual_tokens is null or p_actual_tokens < 0 or p_actual_tokens > 100000000 then
    raise exception 'settle_daily_token_reservation: invalid arguments';
  end if;
  select status into v_status
    from public.daily_token_reservations
   where id = p_reservation_id
   for update;
  if not found then return false; end if;
  if v_status = 'settled' then return true; end if;
  if v_status <> 'reserved' then return false; end if;

  update public.daily_token_reservations
     set status = 'settled', actual_tokens = p_actual_tokens, settled_at = now()
   where id = p_reservation_id;
  return true;
end;
$$;

-- Release is permitted only when the caller knows the provider was never
-- invoked. Unknown provider failures must settle conservatively instead.
create or replace function public.release_daily_token_reservation(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_reservation_id is null then raise exception 'release_daily_token_reservation: invalid arguments'; end if;
  select status into v_status
    from public.daily_token_reservations
   where id = p_reservation_id
   for update;
  if not found then return false; end if;
  if v_status = 'released' then return true; end if;
  if v_status <> 'reserved' then return false; end if;

  update public.daily_token_reservations
     set status = 'released', settled_at = now()
   where id = p_reservation_id;
  return true;
end;
$$;

-- The existing usage API now includes active reservations and settled usage,
-- but excludes usage events linked to reservations to avoid double counting.
create or replace function public.usage_tokens_since(
  p_since timestamptz,
  p_tenant uuid default null,
  p_actor_type text default null,
  p_actor_id text default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select coalesce(sum(e.input_tokens + e.output_tokens), 0)::bigint
      from public.usage_events e
     where e.created_at >= p_since and e.reservation_id is null
       and (p_tenant is null or e.tenant_id = p_tenant)
       and (p_actor_type is null or e.actor_type = p_actor_type)
       and (p_actor_id is null or e.actor_id = p_actor_id)
  ) + (
    select coalesce(sum(case when r.status = 'reserved' then r.reserved_tokens
                             when r.status = 'settled' then r.actual_tokens
                             else 0 end), 0)::bigint
      from public.daily_token_reservations r
     where r.created_at >= p_since and r.status in ('reserved', 'settled')
       and (p_tenant is null or r.tenant_id = p_tenant)
       and (p_actor_type is null or r.actor_type = p_actor_type)
       and (p_actor_id is null or r.actor_id = p_actor_id)
  );
$$;

revoke execute on function public.reserve_daily_tokens(uuid, uuid, text, text, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.settle_daily_token_reservation(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.release_daily_token_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.usage_tokens_since(timestamptz, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_daily_tokens(uuid, uuid, text, text, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.settle_daily_token_reservation(uuid, bigint) to service_role;
grant execute on function public.release_daily_token_reservation(uuid) to service_role;
grant execute on function public.usage_tokens_since(timestamptz, uuid, text, text) to service_role;

commit;
