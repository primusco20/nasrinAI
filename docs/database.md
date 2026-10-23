# Database

NasrinAI uses its own Supabase project. Only the NasrinAI server, with the
service-role key, can read or write its tables. RLS is enabled; server-only tables
have explicit deny policies for `anon` and `authenticated`, and those browser roles
have no table grants. The policies are defense in depth, not a replacement for
server-side authorization.

## Set it up (from a phone is fine)

1. Open your NasrinAI project in Supabase, then **SQL Editor**, then **New query**.
2. Paste the whole of [`db/migrations/001_core.sql`](../db/migrations/001_core.sql) and press **Run**.
3. Expect "Success. No rows returned". Running it again is safe.
4. Do the same with [`db/migrations/002_plans.sql`](../db/migrations/002_plans.sql) (plans for Max and Ultra).
5. Apply later migrations in order only after checking the live schema and migration history. Migration 028 makes the server-only browser-role denial explicit; do not assume it is deployed until execution is confirmed. Migration 029 sets a 50 MB upload limit on the private `media` bucket; it was applied to production on 2026-10-12 (see [supabase-security-baseline.md](supabase-security-baseline.md)).

## Tables

| Table | Holds |
| --- | --- |
| `tenants` | One row per business, plus the NasrinAI platform (`00000000-0000-0000-0000-000000000001`) |
| `api_keys` | Business keys. Secret keys are stored only as a SHA-256 hash |
| `conversations`, `messages` | Chat history, owned by one user, guest or key, within one tenant |
| `rate_counters` | Shared rate-limit counters |
| `usage_events` | One row per model call: tokens, latency, outcome. No message text |
| `plan_periods` | Paid (or owner-granted) Max and Ultra periods, one row per payment ([plans.md](plans.md)) |

## Add a business and its keys

Run these in the SQL Editor. Each key is shown **once**; a secret key cannot be
recovered later, only replaced.

```sql
-- 1. the business
insert into public.tenants (name) values ('My Shop') returning id;

-- 2. a key for a chat widget on its website (public, locked to these sites)
select public.create_api_key('<tenant id>', 'publishable', 'Website', array['https://myshop.com']);

-- 3. a key for its own server, POS or CRM (secret: never put it in a web page)
select public.create_api_key('<tenant id>', 'secret', 'POS');

-- revoke a key by its id (the 12 characters after nsp_ / nss_)
select public.revoke_api_key('<key id>');
```

The NasrinAI server cannot create or revoke keys; only someone with SQL Editor
access can.

## Tests

`db/tests/run.sh` builds a scratch database that copies Supabase's roles and
default grants, runs every migration twice, and checks the access rules. CI runs
it on every push.


## Owner Console telemetry (migration 057)

Migration [`057_owner_console_metrics.sql`](../db/migrations/057_owner_console_metrics.sql) adds server-role-only aggregate RPCs for usage events, automation run states, derived failure/stale-job signals, active user/guest counts and a usage-based 7-day return rate, Auth account-record signals, and Pro/Max/Ultra paid plan entitlements, plus a minimized owner-action audit table and RPC. Usage summaries do not read prompts or message bodies; automation summaries do not return workflow definitions or step payloads. Audit records store session/export event types, actor IDs, and a one-way IP hash rather than the raw address. The audit table has RLS enabled and an explicit deny policy for browser roles; only `service_role` can execute the RPCs.

The migration is part of the repository but has **not** been applied to production. Do not configure production owner access until the migration is applied through the approved process and its schema/permissions are verified. The console reports telemetry as unavailable until the corresponding RPC is reachable.

## Owner Console platform Auth audit (migration 058)

Migration [`058_owner_console_auth_audit.sql`](../db/migrations/058_owner_console_auth_audit.sql) adds a server-role-only aggregate summary of Supabase Auth audit-log categories. It returns only event totals and coarse categories for sign-in, account recovery, password changes, and sign-out; it never returns raw payloads, email addresses, IP addresses, or actor identifiers. If the compatible Auth audit table or expected columns are unavailable, the RPC reports an explicit unavailable state rather than exposing partial records. The migration has not been applied to production; verify its grants and source availability through the approved migration process before relying on these signals.
