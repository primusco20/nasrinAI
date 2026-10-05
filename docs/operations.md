# Operations (Phase 10)

How to run NasrinAI in production and what to do when something goes wrong.

## Before each release

1. CI is green (tests, secret scan, database tests).
2. Supabase migrations are run in order, each once (all are safe to re-run):
   `001_core` … `005_legal`, `006_connectors`, `007_channels`,
   `008_connector_events`, `009_knowledge_memory`.
3. After deploying: open `https://nasrinai.site/healthz` (should say ok), then
   `node scripts/eval/run.js --suite quality` and `--suite redteam`.
4. Vercel → Logs: no `setting ignored` lines you did not expect.

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
| `SUPABASE_SERVICE_ROLE_KEY` | none for users (rotate in Supabase first) |
| `GUEST_SESSION_SECRET` | every guest starts a new session; guest chats are no longer reachable |
| `PAYMONGO_*` | new webhook secret must match PayMongo's |
| `FACEBOOK_APP_SECRET` | none, if updated in Meta at the same time |
| `CONNECTOR_SECRET_KEY` | every business must send its connector keys, webhook secrets and Page tokens again |

## Data

- Guest chats and their pictures: deleted after 24 hours.
- Signed-in users' pictures: kept until `IMAGE_RETENTION_DAYS` is set
  ([REQUIRES INPUT]: the owner's choice, suggested 30).
- Connector events: 30 days. Memories: until the person deletes them or the account.
- Backups: Supabase's backups for your plan (check Supabase → Database →
  Backups; this cannot be verified from the repository).
