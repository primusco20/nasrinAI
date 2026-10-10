-- NasrinAI weekly paid-plan token allowances (migration 016).
-- User reservations count against the active plan's Monday-to-Monday allowance.
-- Tenant cost ceilings and guest ceilings remain daily. Zero actor limit means
-- no per-user token ceiling (Quick); hourly abuse limits remain separate.
begin;

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
  v_week_start timestamptz;
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
  v_week_start := date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
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
       and e.created_at >= v_week_start and e.reservation_id is null;
    select coalesce(sum(case when r.status = 'reserved' then r.reserved_tokens
                             when r.status = 'settled' then r.actual_tokens
                             else 0 end), 0)::bigint
      into v_reserved_actor
      from public.daily_token_reservations r
     where r.tenant_id = p_tenant and r.actor_type = 'user' and r.actor_id = p_actor_id
       and r.day_start >= v_week_start and r.status in ('reserved', 'settled');
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

  if v_actor_limit is not null and v_actor_limit > 0 and actor_used + p_reserved_tokens > v_actor_limit then
    return query select false, case when p_actor_type = 'guest' then 'guest_limit' else 'weekly_limit' end,
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

-- Pro is now a first-class paid plan. Recurring billing lifecycle is handled
-- separately from token quota enforcement; periods are still server-created.
alter table public.plan_periods drop constraint if exists plan_periods_plan_check;
alter table public.plan_periods add constraint plan_periods_plan_check check (plan in ('pro', 'max', 'ultra'));

commit;
