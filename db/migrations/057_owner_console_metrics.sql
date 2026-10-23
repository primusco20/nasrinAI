-- Owner Console metrics: narrowly scoped, aggregate-only server RPC.
-- No browser table access or RLS/grant broadening. No prompt or message content is read.

begin;

create index if not exists usage_events_created_at_idx
  on public.usage_events (created_at desc);

create or replace function public.owner_console_usage_summary(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_since is null or p_since > now() or p_since < now() - interval '90 days' then
    raise exception 'p_since must be within the last 90 days';
  end if;

  select jsonb_build_object(
    'window_start', p_since,
    'window_end', now(),
    'request_count', count(*),
    'success_count', count(*) filter (where outcome = 'ok'),
    'failure_count', count(*) filter (where outcome <> 'ok'),
    'input_tokens', coalesce(sum(input_tokens), 0),
    'output_tokens', coalesce(sum(output_tokens), 0),
    'total_tokens', coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0),
    'active_user_ids', count(distinct actor_id) filter (where actor_type = 'user'),
    'active_guest_ids', count(distinct actor_id) filter (where actor_type = 'guest'),
    'latency_p50_ms', percentile_cont(0.50) within group (order by latency_ms) filter (where outcome = 'ok'),
    'latency_p95_ms', percentile_cont(0.95) within group (order by latency_ms) filter (where outcome = 'ok'),
    'estimated_cost_usd', coalesce(sum(cost_usd), 0),
    'cost_estimate_rows', count(*) filter (where cost_usd is not null),
    'last_event_at', max(created_at),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'feature', f.feature,
        'requests', f.requests,
        'active_user_ids', f.active_user_ids,
        'active_guest_ids', f.active_guest_ids,
        'total_tokens', f.total_tokens,
        'estimated_cost_usd', f.estimated_cost_usd
      ) order by f.requests desc, f.feature)
      from (
        select
          case
            when task in ('coding', 'debugging', 'architecture') then 'coding'
            when task in ('image', 'image_brief', 'marketing_cache_hit') then 'image_generation'
            when task in ('video', 'video_sound_effect', 'video_studio_export', 'video_voiceover') then 'video_studio'
            when task in ('realtime', 'speech', 'transcription') then 'voice'
            when task = 'tool' then 'tools'
            when task in ('chat', 'research', 'scraping', 'generation', 'rendering', 'extraction', 'editing', 'analysis', 'planning', 'design', 'critique') then 'conversation'
            else 'other'
          end as feature,
          count(*) as requests,
          count(distinct actor_id) filter (where actor_type = 'user') as active_user_ids,
          count(distinct actor_id) filter (where actor_type = 'guest') as active_guest_ids,
          coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0) as total_tokens,
          coalesce(sum(cost_usd), 0) as estimated_cost_usd
        from public.usage_events
        where created_at >= p_since
        group by 1
        order by count(*) desc, 1
        limit 10
      ) f
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', p.provider,
        'model', p.model,
        'requests', p.requests,
        'successes', p.successes,
        'input_tokens', p.input_tokens,
        'output_tokens', p.output_tokens,
        'estimated_cost_usd', p.estimated_cost_usd
      ) order by p.requests desc, p.provider, p.model)
      from (
        select provider, model,
               count(*) as requests,
               count(*) filter (where outcome = 'ok') as successes,
               coalesce(sum(input_tokens), 0) as input_tokens,
               coalesce(sum(output_tokens), 0) as output_tokens,
               coalesce(sum(cost_usd), 0) as estimated_cost_usd
          from public.usage_events
         where created_at >= p_since
         group by provider, model
         order by count(*) desc, provider, model
         limit 25
      ) p
    ), '[]'::jsonb)
  )
  into v_result
  from public.usage_events
  where created_at >= p_since;

  return v_result;
end;
$$;

-- Automation status aggregates only. Never return workflow definitions, step arguments, or payloads.
create index if not exists automation_runs_created_at_idx
  on public.automation_runs (created_at desc);

create or replace function public.owner_console_automation_summary(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $owner_automation$
declare
  v_result jsonb;
begin
  if p_since is null or p_since > now() or p_since < now() - interval '90 days' then
    raise exception 'p_since must be within the last 90 days';
  end if;

  select jsonb_build_object(
    'window_start', p_since,
    'window_end', now(),
    'run_count', count(*),
    'pending_approval_count', count(*) filter (where status = 'pending_approval'),
    'queued_count', count(*) filter (where status = 'queued'),
    'running_count', count(*) filter (where status = 'running'),
    'succeeded_count', count(*) filter (where status = 'succeeded'),
    'failed_count', count(*) filter (where status = 'failed'),
    'cancelled_count', count(*) filter (where status = 'cancelled'),
    'stale_running_count', count(*) filter (
      where status = 'running' and coalesce(started_at, created_at) < now() - interval '30 minutes'
    ),
    'avg_duration_ms', round((avg(extract(epoch from (finished_at - started_at)) * 1000)
      filter (where started_at is not null and finished_at is not null and finished_at >= started_at))::numeric, 1),
    'last_run_at', max(created_at),
    'by_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status, 'runs', s.runs) order by s.status)
      from (
        select status, count(*) as runs
        from public.automation_runs
        where created_at >= p_since
        group by status
      ) s
    ), '[]'::jsonb)
  )
  into v_result
  from public.automation_runs
  where created_at >= p_since;

  return v_result;
end;
$owner_automation$;

revoke execute on function public.owner_console_usage_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_usage_summary(timestamptz) to service_role;
revoke execute on function public.owner_console_automation_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_automation_summary(timestamptz) to service_role;


-- Growth signals from recorded usage only; counts are distinct actor IDs, not total registered accounts.
create or replace function public.owner_console_growth_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $owner_growth$
  with active as (
    select actor_type, actor_id,
      bool_or(created_at >= now() - interval '24 hours') as active_24h,
      bool_or(created_at >= now() - interval '7 days') as active_7d,
      bool_or(created_at >= now() - interval '30 days') as active_30d,
      bool_or(created_at >= now() - interval '14 days' and created_at < now() - interval '7 days') as active_prior_7d
    from public.usage_events
    where created_at >= now() - interval '30 days'
      and actor_type in ('user','guest')
      and actor_id is not null
    group by actor_type, actor_id
  )
  select jsonb_build_object(
    'active_user_ids_24h', count(*) filter (where actor_type = 'user' and active_24h),
    'active_guest_ids_24h', count(*) filter (where actor_type = 'guest' and active_24h),
    'active_user_ids_7d', count(*) filter (where actor_type = 'user' and active_7d),
    'active_guest_ids_7d', count(*) filter (where actor_type = 'guest' and active_7d),
    'active_user_ids_30d', count(*) filter (where actor_type = 'user' and active_30d),
    'active_guest_ids_30d', count(*) filter (where actor_type = 'guest' and active_30d),
    'returning_user_ids_7d', count(*) filter (where actor_type = 'user' and active_prior_7d and active_7d),
    'prior_week_user_ids', count(*) filter (where actor_type = 'user' and active_prior_7d),
    'return_rate_pct', case when count(*) filter (where actor_type = 'user' and active_prior_7d) = 0 then null else round(100.0 * count(*) filter (where actor_type = 'user' and active_prior_7d and active_7d) / count(*) filter (where actor_type = 'user' and active_prior_7d), 1) end
  ) from active;
$owner_growth$;

revoke execute on function public.owner_console_growth_summary() from public, anon, authenticated, service_role;
grant execute on function public.owner_console_growth_summary() to service_role;

-- Usage-based retention cohorts. These are first-observed model-call cohorts, not signup cohorts.
create or replace function public.owner_console_retention_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $owner_retention$
  with today as (
    select (now() at time zone 'UTC')::date as day
  ),
  activity as (
    select actor_id, (created_at at time zone 'UTC')::date as active_date
    from public.usage_events
    where created_at >= now() - interval '45 days'
      and actor_type = 'user'
      and actor_id is not null
    group by actor_id, (created_at at time zone 'UTC')::date
  ),
  first_activity as (
    select actor_id, min(active_date) as cohort_date
    from activity
    group by actor_id
  ),
  cohort_rows as (
    select
      f.cohort_date,
      count(*)::bigint as cohort_size,
      count(*) filter (where f.cohort_date < t.day - 1)::bigint as day_1_eligible,
      count(*) filter (where f.cohort_date < t.day - 1 and exists (
        select 1 from activity a where a.actor_id = f.actor_id and a.active_date = f.cohort_date + 1
      ))::bigint as day_1_returned,
      count(*) filter (where f.cohort_date < t.day - 7)::bigint as day_7_eligible,
      count(*) filter (where f.cohort_date < t.day - 7 and exists (
        select 1 from activity a where a.actor_id = f.actor_id and a.active_date = f.cohort_date + 7
      ))::bigint as day_7_returned
    from first_activity f
    cross join today t
    where f.cohort_date >= t.day - 13 and f.cohort_date < t.day
    group by f.cohort_date
  )
  select jsonb_build_object(
    'window_days', 14,
    'generated_at', now(),
    'definition', 'First observed signed-in model-call activity date within a 45-day lookback; day-N return means a model call on exactly cohort date + N.',
    'cohorts', coalesce(jsonb_agg(jsonb_build_object(
      'cohort_date', c.cohort_date,
      'cohort_size', c.cohort_size,
      'day_1_eligible', c.day_1_eligible,
      'day_1_returned', c.day_1_returned,
      'day_1_retention_pct', case when c.day_1_eligible = 0 then null else round(100.0 * c.day_1_returned / c.day_1_eligible, 1) end,
      'day_7_eligible', c.day_7_eligible,
      'day_7_returned', c.day_7_returned,
      'day_7_retention_pct', case when c.day_7_eligible = 0 then null else round(100.0 * c.day_7_returned / c.day_7_eligible, 1) end
    ) order by c.cohort_date desc), '[]'::jsonb)
  )
  from cohort_rows c;
$owner_retention$;

revoke execute on function public.owner_console_retention_summary() from public, anon, authenticated, service_role;
grant execute on function public.owner_console_retention_summary() to service_role;

-- Plan entitlements plus gross recorded PayMongo paid checkout amounts. This is not net revenue: refunds, fees, reversals, and settlement reconciliation are not represented.
create index if not exists plan_periods_created_at_idx on public.plan_periods (created_at desc);
create index if not exists plan_periods_active_expiry_idx on public.plan_periods (ends_at) where status = 'active';

create or replace function public.owner_console_plan_summary(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $owner_plan$
declare
  v_result jsonb;
begin
  if p_since is null or p_since > now() or p_since < now() - interval '90 days' then
    raise exception 'p_since must be within the last 90 days';
  end if;
  select jsonb_build_object(
    'window_start', p_since,
    'window_end', now(),
    'active_paid_periods', count(*) filter (where status = 'active' and ends_at > now()),
    'active_pro_periods', count(*) filter (where status = 'active' and ends_at > now() and plan = 'pro'),
    'active_max_periods', count(*) filter (where status = 'active' and ends_at > now() and plan = 'max'),
    'active_ultra_periods', count(*) filter (where status = 'active' and ends_at > now() and plan = 'ultra'),
    'new_periods', count(*) filter (where created_at >= p_since),
    'paid_payment_count', (select count(*) from public.plan_periods paid where paid.created_at >= p_since and paid.provider = 'paymongo' and paid.amount is not null and paid.currency is not null),
    'gross_paid_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object('currency', paid.currency, 'payment_count', paid.payment_count, 'gross_amount_minor', paid.gross_amount_minor) order by paid.currency)
      from (
        select currency, count(*) as payment_count, sum(amount)::bigint as gross_amount_minor
        from public.plan_periods
        where created_at >= p_since and provider = 'paymongo' and amount is not null and currency is not null
        group by currency
      ) paid
    ), '[]'::jsonb),
    'last_period_at', max(created_at),
    'recent_by_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', p.status, 'plan', p.plan, 'periods', p.periods) order by p.status, p.plan)
      from (
        select status, plan, count(*) as periods
        from public.plan_periods
        where created_at >= p_since
        group by status, plan
      ) p
    ), '[]'::jsonb)
  )
  into v_result
  from public.plan_periods
  where created_at >= p_since or (status = 'active' and ends_at > now());
  return v_result;
end;
$owner_plan$;

revoke execute on function public.owner_console_plan_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_plan_summary(timestamptz) to service_role;
-- Aggregate-only registration signals. No email, auth ID, or user metadata is returned.
create or replace function public.owner_console_user_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $owner_users$
  select jsonb_build_object(
    'auth_user_records', count(*),
    'new_auth_records_24h', count(*) filter (where created_at >= now() - interval '24 hours'),
    'new_auth_records_7d', count(*) filter (where created_at >= now() - interval '7 days'),
    'active_signins_30d', count(*) filter (where last_sign_in_at >= now() - interval '30 days'),
    'last_signup_at', max(created_at)
  )
  from auth.users;
$owner_users$;

revoke execute on function public.owner_console_user_summary() from public, anon, authenticated, service_role;
grant execute on function public.owner_console_user_summary() to service_role;
-- Derived operational signals from existing telemetry. These are not durable incidents or delivered alerts.
create or replace function public.owner_console_incident_summary(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $owner_signals$
declare
  v_result jsonb;
begin
  if p_since is null or p_since > now() or p_since < now() - interval '90 days' then
    raise exception 'p_since must be within the last 90 days';
  end if;

  select jsonb_build_object(
    'window_start', p_since,
    'window_end', now(),
    'ai_failed_requests', (
      select count(*) from public.usage_events
      where created_at >= p_since and outcome <> 'ok'
    ),
    'automation_failed_runs', (
      select count(*) from public.automation_runs
      where created_at >= p_since and status = 'failed'
    ),
    'stale_running_runs', (
      select count(*) from public.automation_runs
      where status = 'running' and coalesce(started_at, created_at) < now() - interval '30 minutes'
    ),
    'last_failure_at', greatest(
      (select max(created_at) from public.usage_events where created_at >= p_since and outcome <> 'ok'),
      (select max(coalesce(finished_at, created_at)) from public.automation_runs where created_at >= p_since and status = 'failed')
    )
  )
  into v_result;
  return v_result;
end;
$owner_signals$;

revoke execute on function public.owner_console_incident_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_incident_summary(timestamptz) to service_role;

-- Minimal owner-action audit trail. Store a one-way IP hash, never the raw address.
create table if not exists public.owner_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('session_issued','session_revoked','usage_export')),
  actor_id text not null check (char_length(actor_id) between 1 and 80),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  outcome text not null default 'success' check (outcome = 'success'),
  created_at timestamptz not null default now()
);

create index if not exists owner_audit_events_created_at_idx
  on public.owner_audit_events (created_at desc);
alter table public.owner_audit_events drop constraint if exists owner_audit_events_event_type_check;
alter table public.owner_audit_events add constraint owner_audit_events_event_type_check
  check (event_type in ('session_issued','session_revoked','usage_export','incident_created','incident_acknowledged','incident_resolved'));

alter table public.owner_audit_events enable row level security;
drop policy if exists server_only_deny_browser on public.owner_audit_events;
create policy server_only_deny_browser on public.owner_audit_events
  for all to anon, authenticated using (false) with check (false);
revoke all on public.owner_audit_events from public, anon, authenticated;
grant select, insert on public.owner_audit_events to service_role;

create or replace function public.owner_console_record_audit(
  p_event_type text, p_actor_id text, p_ip_hash text, p_outcome text default 'success'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_type not in ('session_issued','session_revoked','usage_export')
     or p_actor_id is null or char_length(p_actor_id) not between 1 and 80
     or p_ip_hash !~ '^[a-f0-9]{64}$' or p_outcome <> 'success' then
    raise exception 'invalid owner audit event';
  end if;
  insert into public.owner_audit_events (event_type, actor_id, ip_hash, outcome)
  values (p_event_type, p_actor_id, p_ip_hash, p_outcome);
end;
$$;

create or replace function public.owner_console_audit_summary(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_since is null or p_since > now() or p_since < now() - interval '90 days' then
    raise exception 'p_since must be within the last 90 days';
  end if;
  select jsonb_build_object(
    'window_start', p_since,
    'window_end', now(),
    'event_count', count(*),
    'last_event_at', max(created_at),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('event_type', a.event_type, 'events', a.events) order by a.event_type)
      from (
        select event_type, count(*) as events
        from public.owner_audit_events
        where created_at >= p_since
        group by event_type
      ) a
    ), '[]'::jsonb)
  )
  into v_result
  from public.owner_audit_events
  where created_at >= p_since;
  return v_result;
end;
$$;

revoke execute on function public.owner_console_record_audit(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_record_audit(text, text, text, text) to service_role;
revoke execute on function public.owner_console_audit_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_audit_summary(timestamptz) to service_role;

-- Durable owner-managed incident log. This does not imply notification delivery or automatic remediation.
create table if not exists public.owner_console_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1200),
  severity text not null check (severity in ('low','medium','high','critical')),
  source text not null check (source in ('manual','ai_usage','automation','infrastructure','security')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_by text not null check (char_length(created_by) between 1 and 80),
  acknowledged_by text,
  resolved_by text,
  resolution_note text not null default '' check (char_length(resolution_note) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);
create index if not exists owner_console_incidents_status_created_idx on public.owner_console_incidents (status, created_at desc);
alter table public.owner_console_incidents enable row level security;
drop policy if exists server_only_deny_browser on public.owner_console_incidents;
create policy server_only_deny_browser on public.owner_console_incidents for all to anon, authenticated using (false) with check (false);
revoke all on public.owner_console_incidents from public, anon, authenticated;
grant select, insert, update on public.owner_console_incidents to service_role;

create or replace function public.owner_console_incidents_list(p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $owner_incident_list$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_result jsonb;
begin
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'open', count(*) filter (where status = 'open'),
      'acknowledged', count(*) filter (where status = 'acknowledged'),
      'resolved', count(*) filter (where status = 'resolved'),
      'critical_open', count(*) filter (where status = 'open' and severity = 'critical'),
      'high_open', count(*) filter (where status = 'open' and severity = 'high')
    ),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', item.id, 'title', item.title, 'description', item.description, 'severity', item.severity, 'source', item.source,
      'status', item.status, 'created_at', item.created_at, 'updated_at', item.updated_at,
      'acknowledged_at', item.acknowledged_at, 'resolved_at', item.resolved_at, 'resolution_note', item.resolution_note
    ) order by item.created_at desc) from (select * from public.owner_console_incidents order by created_at desc limit v_limit) item), '[]'::jsonb)
  ) into v_result from public.owner_console_incidents;
  return v_result;
end;
$owner_incident_list$;

create or replace function public.owner_console_incident_create(
  p_title text, p_description text, p_severity text, p_source text, p_actor_id text, p_ip_hash text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $owner_incident_create$
declare
  v_id uuid;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or coalesce(char_length(p_description), 0) > 1200
    or p_severity not in ('low','medium','high','critical')
    or p_source not in ('manual','ai_usage','automation','infrastructure','security')
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 80
    or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid owner incident';
  end if;
  insert into public.owner_console_incidents (title, description, severity, source, created_by)
  values (btrim(p_title), coalesce(p_description, ''), p_severity, p_source, p_actor_id)
  returning id into v_id;
  insert into public.owner_audit_events (event_type, actor_id, ip_hash, outcome)
  values ('incident_created', p_actor_id, p_ip_hash, 'success');
  return v_id;
end;
$owner_incident_create$;

create or replace function public.owner_console_incident_update(
  p_incident_id uuid, p_action text, p_actor_id text, p_ip_hash text, p_resolution_note text default ''
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $owner_incident_update$
declare
  v_status text;
  v_updated timestamptz;
  v_event text;
begin
  if p_action not in ('acknowledge','resolve') or p_actor_id is null or char_length(p_actor_id) not between 1 and 80
    or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
    or coalesce(char_length(p_resolution_note), 0) > 1200
    or (p_action = 'resolve' and char_length(btrim(coalesce(p_resolution_note, ''))) < 3) then
    raise exception 'invalid owner incident update';
  end if;
  select status into v_status from public.owner_console_incidents where id = p_incident_id for update;
  if not found then raise exception 'incident not found' using errcode = 'P0002'; end if;
  if v_status = 'resolved' then
    if p_action = 'resolve' then return jsonb_build_object('id', p_incident_id, 'status', v_status); end if;
    raise exception 'resolved incident cannot be acknowledged';
  end if;
  if p_action = 'acknowledge' and v_status = 'open' then
    update public.owner_console_incidents set status = 'acknowledged', acknowledged_by = p_actor_id, acknowledged_at = now(), updated_at = now() where id = p_incident_id returning status, updated_at into v_status, v_updated;
    v_event := 'incident_acknowledged';
  elsif p_action = 'resolve' then
    update public.owner_console_incidents set status = 'resolved', resolved_by = p_actor_id, resolved_at = now(), resolution_note = btrim(p_resolution_note), updated_at = now() where id = p_incident_id returning status, updated_at into v_status, v_updated;
    v_event := 'incident_resolved';
  elsif p_action = 'acknowledge' and v_status = 'acknowledged' then
    return jsonb_build_object('id', p_incident_id, 'status', v_status);
  else
    raise exception 'invalid incident status transition';
  end if;
  insert into public.owner_audit_events (event_type, actor_id, ip_hash, outcome) values (v_event, p_actor_id, p_ip_hash, 'success');
  return jsonb_build_object('id', p_incident_id, 'status', v_status, 'updated_at', v_updated);
end;
$owner_incident_update$;

revoke execute on function public.owner_console_incidents_list(integer) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_incidents_list(integer) to service_role;
revoke execute on function public.owner_console_incident_create(text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_incident_create(text,text,text,text,text,text) to service_role;
revoke execute on function public.owner_console_incident_update(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_incident_update(uuid,text,text,text,text) to service_role;
commit;
