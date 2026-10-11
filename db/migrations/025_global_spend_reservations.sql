-- Shared, atomic estimated-USD reservations for all paid model calls.
-- Every server instance uses the same PostgreSQL ledger. Reservations are made
-- before a provider call; failed/unknown calls settle conservatively at the
-- reserved estimate. The ledger is not a provider invoice and cannot guarantee
-- exact billing where providers expose no per-turn usage (notably realtime).
begin;

create table if not exists public.spend_reservations (
  id uuid primary key,
  kind text not null check (kind in ('reasoning', 'image')),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'guest', 'service')),
  actor_id text not null check (char_length(actor_id) between 1 and 80),
  reserved_usd numeric(12,6) not null check (reserved_usd > 0),
  actual_usd numeric(12,6) check (actual_usd is null or actual_usd >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((status = 'reserved' and actual_usd is null and settled_at is null)
      or (status = 'settled' and actual_usd is not null and settled_at is not null)
      or (status = 'released' and actual_usd is null and settled_at is not null))
);
create index if not exists spend_reservations_kind_time_idx
  on public.spend_reservations (kind, created_at, status);
create index if not exists spend_reservations_owner_time_idx
  on public.spend_reservations (tenant_id, actor_type, actor_id, created_at);

alter table public.usage_events
  add column if not exists spend_reservation_id uuid
  references public.spend_reservations(id) on delete set null;
create index if not exists usage_events_spend_reservation_idx
  on public.usage_events (spend_reservation_id) where spend_reservation_id is not null;

alter table public.spend_reservations enable row level security;
revoke all on table public.spend_reservations from public, anon, authenticated;
grant select, insert, update, delete on table public.spend_reservations to service_role;

create or replace function public.reserve_global_spend(
  p_reservation_id uuid,
  p_kind text,
  p_tenant uuid,
  p_actor_type text,
  p_actor_id text,
  p_reserved_usd numeric,
  p_daily_limit numeric,
  p_weekly_limit numeric,
  p_monthly_limit numeric,
  p_max_request_usd numeric
)
returns table (allowed boolean, reason text, reservation_id uuid, daily_used numeric, weekly_used numeric, monthly_used numeric)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_day_start timestamptz;
  v_day_used numeric;
  v_week_used numeric;
  v_month_used numeric;
  v_legacy_day numeric;
  v_legacy_week numeric;
  v_legacy_month numeric;
begin
  if p_reservation_id is null
     or p_kind is null or p_kind not in ('reasoning', 'image')
     or p_tenant is null
     or p_actor_type is null or p_actor_type not in ('user', 'guest', 'service')
     or p_actor_id is null or pg_catalog.char_length(p_actor_id) < 1 or pg_catalog.char_length(p_actor_id) > 80
     or p_reserved_usd is null or p_reserved_usd < 0.000001 or p_reserved_usd > 10000
     or (p_daily_limit is not null and p_daily_limit < 0)
     or (p_weekly_limit is not null and p_weekly_limit < 0)
     or (p_monthly_limit is not null and p_monthly_limit < 0)
     or (p_max_request_usd is not null and p_max_request_usd < 0) then
    raise exception 'reserve_global_spend: invalid arguments';
  end if;

  -- A per-kind lock serializes all competing reservations across serverless
  -- instances. Reasoning and image budgets remain intentionally separate.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nasrinai:global-usd:' || p_kind, 0)
  );

  -- Recover reservations orphaned by a process crash or lost response. The
  -- provider may already have charged, so conservatively settle at the held
  -- estimate instead of releasing it. Normal model/media calls finish well
  -- before this 15-minute recovery threshold.
  update public.spend_reservations
     set status = 'settled', actual_usd = reserved_usd, settled_at = v_now
   where kind = p_kind and status = 'reserved' and created_at < v_now - interval '15 minutes';

  if exists (select 1 from public.spend_reservations r where r.id = p_reservation_id) then
    return query select false, 'duplicate_reservation'::text, p_reservation_id,
      0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  if p_max_request_usd is not null and p_reserved_usd > p_max_request_usd then
    return query select false, 'request_limit'::text, null::uuid, 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  v_day_start := pg_catalog.date_trunc('day', v_now at time zone 'Asia/Manila') at time zone 'Asia/Manila';

  select coalesce(sum(case when r.status = 'reserved' then r.reserved_usd else r.actual_usd end), 0)
    into v_day_used
    from public.spend_reservations r
   where r.kind = p_kind and r.created_at >= v_day_start and r.status in ('reserved', 'settled');
  select coalesce(sum(e.cost_usd), 0)
    into v_legacy_day
    from public.usage_events e
   where e.created_at >= v_day_start and e.cost_usd > 0 and e.spend_reservation_id is null
     and ((p_kind = 'image' and e.task = 'image') or (p_kind = 'reasoning' and e.task is distinct from 'image'));
  v_day_used := v_day_used + v_legacy_day;

  select coalesce(sum(case when r.status = 'reserved' then r.reserved_usd else r.actual_usd end), 0)
    into v_week_used
    from public.spend_reservations r
   where r.kind = p_kind and r.created_at >= v_now - interval '7 days' and r.status in ('reserved', 'settled');
  select coalesce(sum(e.cost_usd), 0)
    into v_legacy_week
    from public.usage_events e
   where e.created_at >= v_now - interval '7 days' and e.cost_usd > 0 and e.spend_reservation_id is null
     and ((p_kind = 'image' and e.task = 'image') or (p_kind = 'reasoning' and e.task is distinct from 'image'));
  v_week_used := v_week_used + v_legacy_week;

  select coalesce(sum(case when r.status = 'reserved' then r.reserved_usd else r.actual_usd end), 0)
    into v_month_used
    from public.spend_reservations r
   where r.kind = p_kind and r.created_at >= v_now - interval '30 days' and r.status in ('reserved', 'settled');
  select coalesce(sum(e.cost_usd), 0)
    into v_legacy_month
    from public.usage_events e
   where e.created_at >= v_now - interval '30 days' and e.cost_usd > 0 and e.spend_reservation_id is null
     and ((p_kind = 'image' and e.task = 'image') or (p_kind = 'reasoning' and e.task is distinct from 'image'));
  v_month_used := v_month_used + v_legacy_month;

  if p_daily_limit is not null and v_day_used + p_reserved_usd > p_daily_limit then
    return query select false, 'daily_budget'::text, null::uuid, v_day_used, v_week_used, v_month_used;
    return;
  end if;
  if p_weekly_limit is not null and v_week_used + p_reserved_usd > p_weekly_limit then
    return query select false, 'weekly_budget'::text, null::uuid, v_day_used, v_week_used, v_month_used;
    return;
  end if;
  if p_monthly_limit is not null and v_month_used + p_reserved_usd > p_monthly_limit then
    return query select false, 'monthly_budget'::text, null::uuid, v_day_used, v_week_used, v_month_used;
    return;
  end if;

  insert into public.spend_reservations
    (id, kind, tenant_id, actor_type, actor_id, reserved_usd)
  values
    (p_reservation_id, p_kind, p_tenant, p_actor_type, p_actor_id, p_reserved_usd);

  return query select true, null::text, p_reservation_id, v_day_used, v_week_used, v_month_used;
end;
$$;

create or replace function public.settle_global_spend(p_reservation_id uuid, p_actual_usd numeric)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_status text;
  v_actual numeric;
begin
  if p_reservation_id is null or p_actual_usd is null or p_actual_usd < 0 or p_actual_usd > 100000 then
    raise exception 'settle_global_spend: invalid arguments';
  end if;
  select kind into v_kind from public.spend_reservations where id = p_reservation_id;
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nasrinai:global-usd:' || v_kind, 0)
  );
  select status, actual_usd into v_status, v_actual
    from public.spend_reservations where id = p_reservation_id for update;
  if not found then return false; end if;
  if v_status = 'settled' then return v_actual = p_actual_usd; end if;
  if v_status <> 'reserved' then return false; end if;
  update public.spend_reservations
     set status = 'settled', actual_usd = p_actual_usd, settled_at = pg_catalog.now()
   where id = p_reservation_id;
  return true;
end;
$$;

create or replace function public.release_global_spend(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_status text;
begin
  if p_reservation_id is null then raise exception 'release_global_spend: invalid arguments'; end if;
  select kind into v_kind from public.spend_reservations where id = p_reservation_id;
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nasrinai:global-usd:' || v_kind, 0)
  );
  select status into v_status from public.spend_reservations where id = p_reservation_id for update;
  if not found then return false; end if;
  if v_status = 'released' then return true; end if;
  if v_status <> 'reserved' then return false; end if;
  update public.spend_reservations set status = 'released', settled_at = pg_catalog.now()
   where id = p_reservation_id;
  return true;
end;
$$;

-- Spend views include settled/reserved ledger rows and only legacy usage events
-- without a linked reservation, so a new request is never double-counted.
create or replace function public.usage_cost_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce((select sum(e.cost_usd) from public.usage_events e
      where e.created_at >= p_since and e.cost_usd > 0 and e.spend_reservation_id is null), 0)
    + coalesce((select sum(case when r.status = 'reserved' then r.reserved_usd else r.actual_usd end)
      from public.spend_reservations r where r.created_at >= p_since and r.status in ('reserved', 'settled')), 0);
$$;

create or replace function public.usage_image_cost_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce((select sum(e.cost_usd) from public.usage_events e
      where e.created_at >= p_since and e.cost_usd > 0 and e.task = 'image' and e.spend_reservation_id is null), 0)
    + coalesce((select sum(case when r.status = 'reserved' then r.reserved_usd else r.actual_usd end)
      from public.spend_reservations r where r.kind = 'image' and r.created_at >= p_since and r.status in ('reserved', 'settled')), 0);
$$;

revoke all on function public.reserve_global_spend(uuid,text,uuid,text,text,numeric,numeric,numeric,numeric,numeric) from public, anon, authenticated, service_role;
revoke all on function public.settle_global_spend(uuid,numeric) from public, anon, authenticated, service_role;
revoke all on function public.release_global_spend(uuid) from public, anon, authenticated, service_role;
revoke all on function public.usage_cost_since(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.usage_image_cost_since(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_global_spend(uuid,text,uuid,text,text,numeric,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.settle_global_spend(uuid,numeric) to service_role;
grant execute on function public.release_global_spend(uuid) to service_role;
grant execute on function public.usage_cost_since(timestamptz) to service_role;
grant execute on function public.usage_image_cost_since(timestamptz) to service_role;

commit;
