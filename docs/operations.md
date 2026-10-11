# Operations (Phase 10)

How to run NasrinAI in production and what to do when something goes wrong.

## Before each release

1. CI is green (tests, secret scan, database tests).
2. Supabase migrations are run in order, each once (all are safe to re-run):
   `001_core` … `005_legal`, `006_connectors`, `007_channels`,
   `008_connector_events`, `009_knowledge_memory`, `010_connector_oauth`,
   `011_knowledge_only`, `012_library`, `013_projects`, `014_storage`,
   `015_daily_token_reservations`, `015_retention`,
   `016_hardening`, `016_weekly_paid_token_allowances`,
   `017_nasrinai_connect`, `017_retention_config`, `017_videos`,
   `018_improvement_consent`, `018_marketing_cache`, `018_nasrinai_connect_keys`,
   `019_improvement_examples`, `019_nasrinai_connect_approval`,
   `020_improvement_review_deletion`, `020_nasrinai_connect_publishable_key`,
   `021_nasrinai_connect_account_owner`, `022_security_boundary`,
   `023_semantic_cache_search_path`, `024_security_definer_search_path`,
   `025_global_spend_reservations`.
3. After deploying: open `https://nasrinai.com/healthz` (should say ok), then
   `node scripts/eval/run.js --suite quality` and `--suite redteam`.
4. Vercel → Logs: no `setting ignored` lines you did not expect. Keep `VIDEO_MAX_COST_USD` and `DAILY_BUDGET_USD`/`WEEKLY_BUDGET_USD`/`MONTHLY_BUDGET_USD` aligned with the enabled provider pricing; a video may be refused when its maximum-duration reservation does not fit.
5. In Supabase migration history, verify that `015_daily_token_reservations`, `016_weekly_paid_token_allowances`, and `025_global_spend_reservations` are applied. Missing token RPCs block token-limited calls; a missing global USD reservation RPC blocks paid provider operations.
6. Verify Vercel's production environment variables and the active Supabase project directly in their dashboards. Repository code and a Ready preview do not prove that production secrets, migrations, payment webhook mode, or provider keys are correct.
7. Realtime voice reserves and charges a conservative estimate before returning a short-lived credential. OpenAI sessions are capped to whole-minute durations that fit the smallest configured daily/weekly/monthly budget ceiling (defaults: 4 minutes for the $0.06/minute mini model; 1 minute for the $0.18/minute standard model). The atomic ledger still rejects sessions when actual remaining budget is insufficient. Gemini keeps a 30-minute exposure reservation because credential expiry does not prove an established session has ended; at default budgets this is refused. This is not exact per-turn billing; keep provider-side spending limits enabled and verify the rates in `config/model-prices.json`.

## Scheduled retention

Vercel Cron calls `/v1/internal/retention` hourly. The endpoint requires the `CRON_SECRET` bearer token and invokes the idempotent `purge_retention()` Supabase function. It also invokes `purge_improvement_consent()` to remove guest choice records after 24 hours and signed-in choice records after 10 years. It also runs `purge_improvement_examples()` to delete expired examples and any examples whose matching consent is no longer the latest active grant. Set `CRON_SECRET` as a Vercel Sensitive environment variable before production deployment. The job covers inactive signed-in users, guest expiry, and old operational rate-limit counters.

## Watching

In the Supabase SQL Editor:

```sql
-- cost and quality by day, level, task and model
select * from public.routing_daily order by day desc, cost_usd desc;

-- failures in the last 24 hours
select provider, model, task, outcome, count(*)
from public.usage_events
where created_at > now() - interval '24 hours' and outcome <> 'ok'
group by 1, 2, 3, 4 order by 5 desc;

-- Held and settled estimated spend (never inspect message text; none is stored here)
select kind, status, count(*) as reservations,
       round(sum(case when status = 'reserved' then reserved_usd else coalesce(actual_usd, 0) end), 4) as usd
from public.spend_reservations
where created_at > now() - interval '30 days'
group by kind, status
order by kind, status;
```

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Chat says it cannot answer | Logs: `model call failed`. Key or quota: fix in OpenAI. Quick switches: `ROUTING=fixed`, `TOOLS_ENABLED=false`, then Redeploy. |
| "Spending limit" messages | Expected when budgets are reached. Raise `DAILY_BUDGET_USD` / `WEEKLY_BUDGET_USD` (chat) or `IMAGE_*_BUDGET_USD` (pictures) if intended. |
| Pictures fail | Logs: `image failed` (has the provider's reason). Off switch: remove `GEMINI_API_KEY`. |
| A bad release | Vercel → Deployments → the previous good one → ⋯ → Promote to Production. |
| Abuse from one business | `update public.tenants set status = 'suspended' where id = '<id>';` (all its keys stop at once). |
| One key leaked | Revoke it: `update public.api_keys set revoked_at = now() where id = '<key id>';` |

## If a server secret leaks

Change it at its source, put the new value in Vercel (Sensitive), Redeploy.

| Secret | Effect of changing it |
| --- | --- |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | none for users |
| `SUPABASE_SECRET_KEY` | none for users (rotate in Supabase first) |
| `GUEST_SESSION_SECRET` | every guest starts a new session; guest chats are no longer reachable |
| `PAYMONGO_*` | new webhook secret must match PayMongo's |
| `FACEBOOK_APP_SECRET` | none, if updated in Meta at the same time |
| `CONNECTOR_SECRET_KEY` | every business must send its connector keys, webhook secrets and Page tokens again |

## Data

- Guest chats and their pictures: deleted after 24 hours.
- Signed-in users' pictures: 30 days by default, or the user's selected retention period. The application setting is the source of truth.
- Connector events: 30 days. Memories: until the person deletes them or the account.
- Backups: Supabase manages database backups according to the project's plan and settings. **Application deletion does not guarantee immediate removal from provider backups.** Before launch, verify the project's backup/PITR retention and keep the verified period synchronized with the Privacy Notice.
