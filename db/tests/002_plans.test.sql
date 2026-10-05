-- Checks for migration 002 (plans). Run against a scratch database (see db/tests/run.sh).
\set ON_ERROR_STOP on

-- 1. The browser roles can neither read plans nor grant them.
set role anon;
do $$ begin
  perform 1 from public.plan_periods; raise exception 'anon could read plan_periods';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin
  perform public.add_plan_period('00000000-0000-0000-0000-000000000001', 'u', 'ultra', 30, 'manual');
  raise exception 'authenticated could add a plan';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.grant_plan('a@example.com', 'ultra', 30); raise exception 'authenticated could grant a plan';
exception when insufficient_privilege then null; end $$;
reset role;

-- 2. The server can record payments, once per payment, but cannot grant by email.
set role service_role;
do $$
declare a uuid; b uuid; e1 timestamptz; e2 timestamptz;
begin
  a := public.add_plan_period('00000000-0000-0000-0000-000000000001', 'user-p', 'max', 30, 'paymongo', 'cs_1', 49900, 'PHP');
  b := public.add_plan_period('00000000-0000-0000-0000-000000000001', 'user-p', 'max', 30, 'paymongo', 'cs_1', 49900, 'PHP');
  if a is null or b is not null then raise exception 'a repeated payment must be counted once'; end if;
  perform public.add_plan_period('00000000-0000-0000-0000-000000000001', 'user-p', 'max', 30, 'paymongo', 'cs_2', 49900, 'PHP');
  select min(ends_at), max(ends_at) into e1, e2 from public.plan_periods where user_id = 'user-p';
  if e2 - e1 < interval '29 days' then raise exception 'paying early must add days after the current period'; end if;
  begin
    perform public.add_plan_period('00000000-0000-0000-0000-000000000001', 'user-p', 'mega', 30, 'paymongo', 'cs_3');
    raise exception 'unknown plan accepted';
  exception when check_violation then null; end;
  begin
    perform public.grant_plan('a@example.com', 'ultra', 30); raise exception 'service_role could grant a plan by email';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. The owner can grant by email; unknown emails are refused.
insert into auth.users (email) values ('owner@example.com');
do $$ begin
  if public.grant_plan('Owner@Example.com', 'ultra', 30) is null then raise exception 'grant_plan returned nothing'; end if;
  begin
    perform public.grant_plan('nobody@example.com', 'ultra', 30); raise exception 'unknown email accepted';
  exception when raise_exception then
    if sqlerrm not like 'No signed-in NasrinAI user%' then raise; end if;
  end;
end $$;

select 'plans checks passed' as result;
