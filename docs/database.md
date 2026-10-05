# Database

NasrinAI uses its own Supabase project. Only the NasrinAI server, with the
service-role key, can read or write its tables: RLS is on with no policies, and
the browser roles (`anon`, `authenticated`) have no grants.

## Set it up (from a phone is fine)

1. Open your NasrinAI project in Supabase, then **SQL Editor**, then **New query**.
2. Paste the whole of [`db/migrations/001_core.sql`](../db/migrations/001_core.sql) and press **Run**.
3. Expect "Success. No rows returned". Running it again is safe.
4. Do the same with [`db/migrations/002_plans.sql`](../db/migrations/002_plans.sql) (plans for Max and Ultra).

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
