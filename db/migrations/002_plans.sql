-- NasrinAI plans (migration 002)
-- =============================================================================
-- Run once in the Supabase SQL editor of the NasrinAI project, after 001.
-- Safe to run again.
--
-- A plan (Max or Ultra) is a paid period for one signed-in user. Each payment,
-- or each manual grant by the owner, adds one row. A user's plan is the highest
-- plan among their rows that are active and not yet over.
--
-- Same access rule as 001: only the NasrinAI server (service role) can read or
-- write; the browser roles get nothing.
-- =============================================================================

begin;

create table if not exists public.plan_periods (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      text not null check (char_length(user_id) between 1 and 80),
  plan         text not null check (plan in ('max', 'ultra')),
  status       text not null default 'active' check (status in ('active', 'canceled')),
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz not null,
  provider     text not null check (provider in ('manual', 'paymongo')),
  -- The payment provider's id for this payment. Unique, so a payment that is
  -- reported twice is only counted once.
  provider_ref text check (provider_ref is null or char_length(provider_ref) between 1 and 200),
  amount       integer check (amount is null or amount >= 0),       -- smallest currency unit (centavos)
  currency     text check (currency is null or currency ~ '^[A-Z]{3}$'),
  created_at   timestamptz not null default now(),
  constraint plan_periods_order check (ends_at > starts_at)
);
create unique index if not exists plan_periods_ref_idx on public.plan_periods (provider, provider_ref) where provider_ref is not null;
create index if not exists plan_periods_user_idx on public.plan_periods (tenant_id, user_id, ends_at desc);

-- Adds a paid period. A new period starts when the user's current period of
-- the same plan ends, so paying early never loses days. Repeating the same
-- provider_ref does nothing and returns null.
create or replace function public.add_plan_period(
  p_tenant uuid, p_user text, p_plan text, p_days integer,
  p_provider text, p_ref text default null, p_amount integer default null, p_currency text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_id uuid;
begin
  if p_days is null or p_days < 1 or p_days > 400 then
    raise exception 'p_days must be between 1 and 400';
  end if;
  select greatest(now(), coalesce(max(ends_at), now())) into v_start
    from public.plan_periods
   where tenant_id = p_tenant and user_id = p_user and plan = p_plan
     and status = 'active' and ends_at > now();
  insert into public.plan_periods (tenant_id, user_id, plan, starts_at, ends_at, provider, provider_ref, amount, currency)
  values (p_tenant, p_user, p_plan, v_start, v_start + make_interval(days => p_days), p_provider, p_ref, p_amount, p_currency)
  on conflict (provider, provider_ref) where provider_ref is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- For the owner, in the SQL editor: give someone a plan by email.
--   select public.grant_plan('person@example.com', 'ultra', 30);
create or replace function public.grant_plan(p_email text, p_plan text, p_days integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user text;
begin
  select id::text into v_user from auth.users where lower(email) = lower(p_email) limit 1;
  if v_user is null then
    raise exception 'No signed-in NasrinAI user has the email %. They must sign in once first.', p_email;
  end if;
  return public.add_plan_period('00000000-0000-0000-0000-000000000001', v_user, p_plan, p_days, 'manual');
end;
$$;

alter table public.plan_periods enable row level security;
revoke all on table public.plan_periods from anon, authenticated;
grant select, insert, update on table public.plan_periods to service_role;

revoke execute on function public.add_plan_period(uuid, text, text, integer, text, text, integer, text),
                           public.grant_plan(text, text, integer)
  from public, anon, authenticated, service_role;
-- The server records payments; only the owner (SQL editor) grants plans by hand.
grant execute on function public.add_plan_period(uuid, text, text, integer, text, text, integer, text) to service_role;

commit;
