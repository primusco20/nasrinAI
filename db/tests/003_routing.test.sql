-- Checks for migration 003 (routing telemetry). Run via db/tests/run.sh.
\set ON_ERROR_STOP on

set role service_role;
do $$
declare spent numeric;
begin
  insert into public.usage_events (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, outcome, task, level, cost_usd, cached_tokens, escalated)
  values ('00000000-0000-0000-0000-000000000001', 'user', 'u-r', 'openai', 'gpt-6-luna', 1000, 200, 'ok', 'chat', 1, 0.0002, 0, false),
         ('00000000-0000-0000-0000-000000000001', 'user', 'u-r', 'logic', 'rules', 0, 0, 'ok', 'math', 0, 0, null, false),
         ('00000000-0000-0000-0000-000000000001', 'user', 'u-r', 'openai', 'gpt-6-luna', 0, 0, 'budget_blocked', 'chat', 1, 0, null, false);
  spent := public.usage_cost_since(now() - interval '1 hour');
  if spent < 0.0002 then raise exception 'usage_cost_since did not count the call (%).', spent; end if;
  begin
    insert into public.usage_events (tenant_id, actor_type, actor_id, provider, model, input_tokens, output_tokens, outcome, level)
    values ('00000000-0000-0000-0000-000000000001', 'user', 'u-r', 'openai', 'x', 0, 0, 'ok', 9);
    raise exception 'level 9 accepted';
  exception when check_violation then null; end;
end $$;
reset role;

set role anon;
do $$ begin
  perform 1 from public.routing_daily; raise exception 'anon could read routing_daily';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.usage_cost_since(now()); raise exception 'anon could read spend';
exception when insufficient_privilege then null; end $$;
reset role;

select 'routing checks passed' as result;
