-- Aggregate-only Owner Console RPC stays server-role only and counts exact rows.
\set ON_ERROR_STOP on

insert into auth.users (id, raw_user_meta_data, created_at, last_sign_in_at)
values ('eeeeeeee-0000-4000-8000-000000000042', '{}'::jsonb, now(), now() - interval '1 day')
on conflict (id) do update set created_at = excluded.created_at, last_sign_in_at = excluded.last_sign_in_at;
set role service_role;
do $owner_test$
declare
  v_before jsonb;
  v_after jsonb;
begin
  v_before := public.owner_console_usage_summary(now() - interval '1 hour');
  insert into public.usage_events
    (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, latency_ms, outcome, cost_usd, task)
  values
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-user-a', 'owner-test-provider', 'owner-test-model', 10, 5, 100, 'ok', 0.01, 'chat'),
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-user-b', 'owner-test-provider', 'owner-test-model', 20, 10, 300, 'ok', 0.02, 'chat'),
    ('00000000-0000-0000-0000-000000000001', 'guest', 'owner-metrics-guest-c', 'owner-test-provider', 'owner-test-model', 30, 15, 500, 'timeout', null, 'chat');
  v_after := public.owner_console_usage_summary(now() - interval '1 hour');

  if (v_after->>'request_count')::bigint <> (v_before->>'request_count')::bigint + 3 then
    raise exception 'owner metrics request count does not include exactly the inserted calls';
  end if;
  if (v_after->>'total_tokens')::bigint <> (v_before->>'total_tokens')::bigint + 90 then
    raise exception 'owner metrics token sum is incorrect';
  end if;
  if (v_after->>'cost_estimate_rows')::bigint <> (v_before->>'cost_estimate_rows')::bigint + 2 then
    raise exception 'owner metrics must count only rows with a recorded estimate';
  end if;
  if not (v_after->'providers' @> '[{"provider":"owner-test-provider","model":"owner-test-model"}]'::jsonb) then
    raise exception 'owner metrics provider breakdown is missing';
  end if;
  if coalesce((select (item->>'requests')::bigint from jsonb_array_elements(v_after->'features') item where item->>'feature' = 'conversation'), 0)
       <> coalesce((select (item->>'requests')::bigint from jsonb_array_elements(v_before->'features') item where item->>'feature' = 'conversation'), 0) + 3
    or coalesce((select (item->>'active_user_ids')::bigint from jsonb_array_elements(v_after->'features') item where item->>'feature' = 'conversation'), 0)
       < coalesce((select (item->>'active_user_ids')::bigint from jsonb_array_elements(v_before->'features') item where item->>'feature' = 'conversation'), 0) then
    raise exception 'feature adoption aggregate did not classify the seeded conversation events';
  end if;

  begin
    perform public.owner_console_usage_summary(now() + interval '1 minute');
    raise exception 'future summary window unexpectedly accepted';
  exception when raise_exception then
    if sqlerrm <> 'p_since must be within the last 90 days' then raise; end if;
  end;
end $owner_test$;

do $owner_retention_test$
declare
  v_summary jsonb;
  v_cohort jsonb;
  v_cohort_date text := ((now() at time zone 'UTC')::date - 10)::text;
begin
  insert into public.usage_events
    (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, latency_ms, outcome, task, created_at)
  values
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-retention-d7', 'owner-test-provider', 'owner-test-model', 1, 1, 1, 'ok', 'chat', now() - interval '10 days'),
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-retention-d7', 'owner-test-provider', 'owner-test-model', 1, 1, 1, 'ok', 'chat', now() - interval '3 days'),
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-retention-d1', 'owner-test-provider', 'owner-test-model', 1, 1, 1, 'ok', 'chat', now() - interval '4 days'),
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-retention-d1', 'owner-test-provider', 'owner-test-model', 1, 1, 1, 'ok', 'chat', now() - interval '3 days');
  v_summary := public.owner_console_retention_summary();
  select item into v_cohort
    from jsonb_array_elements(v_summary->'cohorts') item
   where item->>'cohort_date' = v_cohort_date;
  if v_cohort is null
    or (v_cohort->>'cohort_size')::bigint < 1
    or (v_cohort->>'day_7_eligible')::bigint < 1
    or (v_cohort->>'day_7_returned')::bigint < 1
    or (v_cohort->>'day_7_retention_pct')::numeric < 0
    or (v_cohort->>'day_7_retention_pct')::numeric > 100 then
    raise exception 'usage-based day-7 retention cohort was not calculated correctly';
  end if;
  if v_summary->>'definition' not like 'First observed signed-in model-call activity date%' then
    raise exception 'retention cohort definition must be explicit';
  end if;
end $owner_retention_test$;

do $owner_growth_test$
declare
  v_summary jsonb;
begin
  v_summary := public.owner_console_growth_summary();
  if (v_summary->>'active_user_ids_24h')::bigint < 2
    or (v_summary->>'active_guest_ids_24h')::bigint < 1
    or (v_summary->>'active_user_ids_7d')::bigint < 2 then
    raise exception 'growth summary did not include seeded active actor IDs';
  end if;
  if (v_summary->>'prior_week_user_ids')::bigint = 0 and v_summary->>'return_rate_pct' is not null then
    raise exception 'return rate must be null when the prior-week cohort is empty';
  end if;
  if (v_summary->>'prior_week_user_ids')::bigint > 0 and ((v_summary->>'return_rate_pct')::numeric < 0 or (v_summary->>'return_rate_pct')::numeric > 100) then
    raise exception 'return rate must be between 0 and 100';
  end if;
end $owner_growth_test$;

do $owner_test$
declare
  v_before jsonb;
  v_after jsonb;
  v_workflow uuid;
begin
  v_before := public.owner_console_automation_summary(now() - interval '1 hour');
  insert into public.automation_workflows
    (tenant_id, owner_type, owner_id, name, definition)
  values
    ('00000000-0000-0000-0000-000000000001', 'user', 'owner-metrics-automation', 'Owner metrics test workflow',
     '{"steps":[{"id":"step-1","tool":"noop"}]}'::jsonb)
  returning id into v_workflow;

  insert into public.automation_runs
    (tenant_id, workflow_id, owner_type, owner_id, status, trigger_type, idempotency_key, started_at, finished_at, created_at)
  values
    ('00000000-0000-0000-0000-000000000001', v_workflow, 'user', 'owner-metrics-automation', 'succeeded', 'manual', 'owner-run-0001', now() - interval '2 minutes', now() - interval '1 minute', now()),
    ('00000000-0000-0000-0000-000000000001', v_workflow, 'user', 'owner-metrics-automation', 'failed', 'manual', 'owner-run-0002', now() - interval '2 minutes', now() - interval '1 minute', now()),
    ('00000000-0000-0000-0000-000000000001', v_workflow, 'user', 'owner-metrics-automation', 'running', 'manual', 'owner-run-0003', now() - interval '40 minutes', null, now() - interval '40 minutes');

  v_after := public.owner_console_automation_summary(now() - interval '1 hour');
  if (v_after->>'run_count')::bigint <> (v_before->>'run_count')::bigint + 3 then
    raise exception 'automation summary did not count the inserted runs';
  end if;
  if (v_after->>'succeeded_count')::bigint <> (v_before->>'succeeded_count')::bigint + 1
    or (v_after->>'failed_count')::bigint <> (v_before->>'failed_count')::bigint + 1
    or (v_after->>'running_count')::bigint <> (v_before->>'running_count')::bigint + 1
    or (v_after->>'stale_running_count')::bigint <> (v_before->>'stale_running_count')::bigint + 1 then
    raise exception 'automation status or stale-run counts are incorrect';
  end if;
end $owner_test$;

do $owner_signals_test$
declare
  v_summary jsonb;
begin
  v_summary := public.owner_console_incident_summary(now() - interval '1 hour');
  if (v_summary->>'ai_failed_requests')::bigint < 1
    or (v_summary->>'automation_failed_runs')::bigint < 1
    or (v_summary->>'stale_running_runs')::bigint < 1 then
    raise exception 'derived operational signals did not include the seeded failures and stale run';
  end if;
end $owner_signals_test$;

do $owner_plan_test$
declare
  v_before jsonb;
  v_after jsonb;
begin
  v_before := public.owner_console_plan_summary(now() - interval '1 hour');
  insert into public.plan_periods
    (tenant_id, user_id, plan, status, starts_at, ends_at, provider, amount, currency)
  values
    ('00000000-0000-0000-0000-000000000001', 'owner-metrics-plan-pro', 'pro', 'active', now() - interval '1 day', now() + interval '30 days', 'manual', null, null),
    ('00000000-0000-0000-0000-000000000001', 'owner-metrics-plan-max', 'max', 'active', now() - interval '1 day', now() + interval '30 days', 'manual', null, null),
    ('00000000-0000-0000-0000-000000000001', 'owner-metrics-plan-ultra', 'ultra', 'canceled', now() - interval '30 days', now() - interval '1 day', 'manual', null, null);
  insert into public.plan_periods
    (tenant_id, user_id, plan, status, starts_at, ends_at, provider, amount, currency)
  values ('00000000-0000-0000-0000-000000000001', 'owner-metrics-paid-checkout', 'pro', 'active', now() - interval '1 hour', now() + interval '30 days', 'paymongo', 12345, 'PHP');
  v_after := public.owner_console_plan_summary(now() - interval '1 hour');
  if (v_after->>'active_paid_periods')::bigint <> (v_before->>'active_paid_periods')::bigint + 3
    or (v_after->>'active_pro_periods')::bigint <> (v_before->>'active_pro_periods')::bigint + 2
    or (v_after->>'active_max_periods')::bigint <> (v_before->>'active_max_periods')::bigint + 1
    or (v_after->>'active_ultra_periods')::bigint <> (v_before->>'active_ultra_periods')::bigint
    or (v_after->>'new_periods')::bigint <> (v_before->>'new_periods')::bigint + 4
    or (v_after->>'paid_payment_count')::bigint <> (v_before->>'paid_payment_count')::bigint + 1
    or coalesce((select (item->>'gross_amount_minor')::bigint from jsonb_array_elements(v_after->'gross_paid_by_currency') item where item->>'currency' = 'PHP'), 0)
      <> coalesce((select (item->>'gross_amount_minor')::bigint from jsonb_array_elements(v_before->'gross_paid_by_currency') item where item->>'currency' = 'PHP'), 0) + 12345 then
    raise exception 'plan entitlement or gross paid checkout summary counts are incorrect';
  end if;
end $owner_plan_test$;

do $owner_users_test$
declare
  v_summary jsonb;
begin
  v_summary := public.owner_console_user_summary();
  if (v_summary->>'auth_user_records')::bigint < 1
    or (v_summary->>'new_auth_records_24h')::bigint < 1
    or (v_summary->>'new_auth_records_7d')::bigint < 1
    or (v_summary->>'active_signins_30d')::bigint < 1 then
    raise exception 'owner user summary did not include the seeded Auth record';
  end if;
end $owner_users_test$;

do $owner_test$
declare
  v_before jsonb;
  v_after jsonb;
begin
  v_before := public.owner_console_audit_summary(now() - interval '1 hour');
  perform public.owner_console_record_audit('session_issued', 'owner-metrics-audit', repeat('a', 64), 'success');
  perform public.owner_console_record_audit('usage_export', 'owner-metrics-audit', repeat('b', 64), 'success');
  v_after := public.owner_console_audit_summary(now() - interval '1 hour');
  if (v_after->>'event_count')::bigint <> (v_before->>'event_count')::bigint + 2 then
    raise exception 'owner audit summary did not count the inserted events';
  end if;
  if not (v_after->'by_type' @> '[{"event_type":"session_issued","events":1},{"event_type":"usage_export","events":1}]'::jsonb) then
    raise exception 'owner audit event types are missing from summary';
  end if;
end $owner_test$;
do $owner_incident_test$
declare
  v_id uuid;
  v_result jsonb;
  v_list jsonb;
begin
  v_id := public.owner_console_incident_create('Owner console test incident', 'Test lifecycle and audit behavior.', 'high', 'manual', 'owner-metrics-incident', repeat('c', 64));
  v_list := public.owner_console_incidents_list(10);
  if (v_list->'counts'->>'open')::bigint < 1 then raise exception 'incident list did not count the new open incident'; end if;
  v_result := public.owner_console_incident_update(v_id, 'acknowledge', 'owner-metrics-incident', repeat('c', 64), '');
  if v_result->>'status' <> 'acknowledged' then raise exception 'incident acknowledgement failed'; end if;
  v_result := public.owner_console_incident_update(v_id, 'resolve', 'owner-metrics-incident', repeat('c', 64), 'Verified and resolved for test');
  if v_result->>'status' <> 'resolved' then raise exception 'incident resolution failed'; end if;
  v_list := public.owner_console_incidents_list(10);
  if not (v_list->'incidents' @> jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'resolved'))) then raise exception 'resolved incident was not returned'; end if;
  if not exists (select 1 from public.owner_audit_events where actor_id = 'owner-metrics-incident' and event_type in ('incident_created','incident_acknowledged','incident_resolved') group by actor_id having count(*) = 3) then raise exception 'incident lifecycle audit trail is incomplete'; end if;
end $owner_incident_test$;

reset role;

set role authenticated;
do $owner_test$
begin
  begin
    perform public.owner_console_usage_summary(now() - interval '1 hour');
    raise exception 'authenticated role unexpectedly executed owner metrics';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_automation_summary(now() - interval '1 hour');
    raise exception 'authenticated role unexpectedly executed owner automation summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_growth_summary();
    raise exception 'authenticated role unexpectedly executed owner growth summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_retention_summary();
    raise exception 'authenticated role unexpectedly executed owner retention summary';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.owner_console_user_summary();
    raise exception 'authenticated role unexpectedly executed owner user summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_incident_summary(now() - interval '1 hour');
    raise exception 'authenticated role unexpectedly executed owner incident summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_plan_summary(now() - interval '1 hour');
    raise exception 'authenticated role unexpectedly executed owner plan summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_audit_summary(now() - interval '1 hour');
    raise exception 'authenticated role unexpectedly executed owner audit summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_record_audit('session_issued', 'owner-metrics-audit', repeat('a', 64), 'success');
    raise exception 'authenticated role unexpectedly wrote owner audit events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_incidents_list(10);
    raise exception 'authenticated role unexpectedly read owner incidents';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_incident_create('Unauthorized incident', '', 'low', 'manual', 'auth-test', repeat('d', 64));
    raise exception 'authenticated role unexpectedly created owner incidents';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_console_incident_update(gen_random_uuid(), 'acknowledge', 'auth-test', repeat('d', 64), '');
    raise exception 'authenticated role unexpectedly updated owner incidents';
  exception when insufficient_privilege then null;
  end;
end $owner_test$;
reset role;

select 'owner console aggregate metrics checks passed' as result;
