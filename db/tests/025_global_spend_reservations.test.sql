-- Migration 025: global USD budget reservations and least-privilege RPCs.
\set ON_ERROR_STOP on

do $$
declare
  tenant uuid := '00000000-0000-0000-0000-000000000001';
  first_id uuid := '10000000-0000-4000-8000-000000000001';
  second_id uuid := '10000000-0000-4000-8000-000000000002';
  third_id uuid := '10000000-0000-4000-8000-000000000003';
  probe_id uuid := '10000000-0000-4000-8000-000000000004';
  image_probe_id uuid := '10000000-0000-4000-8000-000000000005';
  r record;
  daily_base numeric;
  weekly_base numeric;
  monthly_base numeric;
  image_day_base numeric;
  image_week_base numeric;
  image_month_base numeric;
  cost_before numeric;
  cost_after numeric;
begin
  select * into r from public.reserve_global_spend(probe_id, 'reasoning', tenant, 'user', 'budget-test',
    0.000001, 1000, 1000, 1000, 1000);
  if not r.allowed then raise exception 'baseline probe must fit'; end if;
  daily_base := r.daily_used;
  weekly_base := r.weekly_used;
  monthly_base := r.monthly_used;
  if not public.release_global_spend(probe_id) then raise exception 'baseline probe release failed'; end if;

  select * into r from public.reserve_global_spend(first_id, 'reasoning', tenant, 'user', 'budget-test',
    0.040000, daily_base + 0.055000, weekly_base + 0.100000, monthly_base + 0.200000, 0.050000);
  if not r.allowed then raise exception 'first spend reservation should fit: %', r.reason; end if;

  select * into r from public.reserve_global_spend(second_id, 'reasoning', tenant, 'user', 'budget-test',
    0.020000, daily_base + 0.055000, weekly_base + 0.100000, monthly_base + 0.200000, 0.050000);
  if r.allowed or r.reason <> 'daily_budget' then raise exception 'concurrent reservation must respect held spend: %', row_to_json(r); end if;

  if not public.settle_global_spend(first_id, 0.010000) then raise exception 'settlement failed'; end if;
  if not public.settle_global_spend(first_id, 0.010000) then raise exception 'identical settlement must be idempotent'; end if;
  if public.settle_global_spend(first_id, 0.020000) then raise exception 'conflicting settlement must not overwrite actual spend'; end if;

  select public.usage_cost_since(pg_catalog.now() - interval '1 minute') into cost_before;
  insert into public.usage_events
    (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, latency_ms, outcome, task, cost_usd, spend_reservation_id)
  values (tenant, 'user', 'budget-test', 'openai', 'gpt-5-mini', 10, 5, 1, 'ok', 'chat', 0.010000, first_id);
  select public.usage_cost_since(pg_catalog.now() - interval '1 minute') into cost_after;
  if abs(cost_after - cost_before) > 0.000001 then raise exception 'reservation-linked telemetry must not double-count'; end if;

  select * into r from public.reserve_global_spend(second_id, 'reasoning', tenant, 'user', 'budget-test',
    0.040000, daily_base + 0.055000, weekly_base + 0.100000, monthly_base + 0.200000, 0.050000);
  if not r.allowed then raise exception 'reservation should fit after reconciliation: %', r.reason; end if;
  if not public.release_global_spend(second_id) then raise exception 'release failed'; end if;
  if not public.release_global_spend(second_id) then raise exception 'release must be idempotent'; end if;

  select * into r from public.reserve_global_spend(image_probe_id, 'image', tenant, 'user', 'budget-test',
    0.000001, 1000, 1000, 1000, null);
  if not r.allowed then raise exception 'image baseline probe must fit'; end if;
  image_day_base := r.daily_used;
  image_week_base := r.weekly_used;
  image_month_base := r.monthly_used;
  if not public.release_global_spend(image_probe_id) then raise exception 'image baseline probe release failed'; end if;

  select * into r from public.reserve_global_spend(third_id, 'image', tenant, 'user', 'budget-test',
    0.080000, image_day_base + 0.100000, image_week_base + 0.200000, image_month_base + 0.300000, null);
  if not r.allowed then raise exception 'image budget must be independent of reasoning: %', r.reason; end if;
  if not public.release_global_spend(third_id) then raise exception 'image reservation release failed'; end if;

  select public.usage_cost_since(pg_catalog.now() - interval '1 minute') into cost_before;
  insert into public.usage_events
    (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, latency_ms, outcome, task, cost_usd)
  values (tenant, 'user', 'legacy-budget-test', 'openai', 'gpt-5-mini', 10, 5, 1, 'ok', 'chat', 0.005000);
  select public.usage_cost_since(pg_catalog.now() - interval '1 minute') into cost_after;
  if abs((cost_after - cost_before) - 0.005000) > 0.000001 then
    raise exception 'legacy usage must remain counted by the shared ledger';
  end if;
end $$;

do $$
begin
  if has_table_privilege('anon', 'public.spend_reservations', 'SELECT')
     or has_table_privilege('authenticated', 'public.spend_reservations', 'SELECT')
     or has_table_privilege('anon', 'public.spend_reservations', 'INSERT')
     or has_table_privilege('authenticated', 'public.spend_reservations', 'INSERT') then
    raise exception 'browser roles must not access spend reservations';
  end if;
  if has_function_privilege('anon', 'public.reserve_global_spend(uuid,text,uuid,text,text,numeric,numeric,numeric,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reserve_global_spend(uuid,text,uuid,text,text,numeric,numeric,numeric,numeric,numeric)', 'EXECUTE')
  then
    raise exception 'browser roles must not reserve global spend';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     where p.oid = 'public.reserve_global_spend(uuid,text,uuid,text,text,numeric,numeric,numeric,numeric,numeric)'::regprocedure
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC must not execute global spend reservation RPC';
  end if;
end $$;

select 'global USD reservation checks passed' as result;
