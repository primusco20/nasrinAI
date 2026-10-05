-- NasrinAI routing telemetry and spend (migration 003)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001 and 002. Safe to run again.
--
-- Adds what the cost-aware router records for each model call: the kind of
-- task, the routing level, the estimated cost, cached tokens and whether it
-- was escalated or answered from cache. Still no message text.
-- =============================================================================

begin;

alter table public.usage_events add column if not exists task           text check (task is null or char_length(task) <= 40);
alter table public.usage_events add column if not exists level          smallint check (level is null or level between 0 and 5);
alter table public.usage_events add column if not exists cost_usd       numeric(12, 6) check (cost_usd is null or cost_usd >= 0);
alter table public.usage_events add column if not exists cached_tokens  integer check (cached_tokens is null or cached_tokens >= 0);
alter table public.usage_events add column if not exists escalated      boolean not null default false;
alter table public.usage_events add column if not exists cache_hit      boolean not null default false;

-- 'logic' calls (answered by code, no model) and cache hits are recorded too.
alter table public.usage_events drop constraint if exists usage_events_outcome_check;
alter table public.usage_events add constraint usage_events_outcome_check
  check (outcome in ('ok', 'provider_error', 'timeout', 'rejected_output', 'budget_blocked'));

create index if not exists usage_events_at_cost_idx on public.usage_events (created_at) where cost_usd > 0;

-- Estimated spend since a moment, for the budget controller.
create or replace function public.usage_cost_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(cost_usd), 0) from public.usage_events where created_at >= p_since;
$$;

-- For the owner (SQL editor): how routing is doing, by day.
create or replace view public.routing_daily
with (security_invoker = true) as
select date_trunc('day', created_at at time zone 'Asia/Manila') as day,
       level, task, provider, model,
       count(*)                                         as calls,
       count(*) filter (where outcome = 'ok')           as ok,
       count(*) filter (where escalated)                as escalated,
       count(*) filter (where cache_hit)                as cache_hits,
       sum(input_tokens)                                as input_tokens,
       sum(coalesce(cached_tokens, 0))                  as cached_tokens,
       sum(output_tokens)                               as output_tokens,
       round(sum(coalesce(cost_usd, 0)), 4)             as cost_usd,
       round(sum(coalesce(cost_usd, 0)) / nullif(count(*) filter (where outcome = 'ok'), 0), 6) as cost_per_success_usd,
       round(avg(latency_ms))                           as avg_latency_ms
  from public.usage_events
 group by 1, 2, 3, 4, 5;

revoke all on table public.routing_daily from anon, authenticated;
revoke execute on function public.usage_cost_since(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.usage_cost_since(timestamptz) to service_role;

commit;
