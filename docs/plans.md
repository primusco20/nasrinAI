# Plans: Max and Ultra

Signed-in users get NasrinAI and Pro for free. **Max** and **Ultra** come with
a plan:

| Plan | Tiers | Price |
| --- | --- | --- |
| Free | NasrinAI, Pro | ₱0 |
| Max | NasrinAI, Pro, Max | `PLAN_MAX_PRICE` per 30 days |
| Ultra | NasrinAI, Pro, Max, Ultra | `PLAN_ULTRA_PRICE` per 30 days |

A plan is a 30-day period. Paying again before it ends adds 30 days after the
current period, so no days are lost. Business keys are not limited by plans.

## Set it up

1. **Database:** in Supabase **SQL Editor**, run
   [`db/migrations/002_plans.sql`](../db/migrations/002_plans.sql) once.
   Until then every signed-in user is treated as Free (chat still works).
2. **Prices (when you decide):** in Vercel add `PLAN_MAX_PRICE` and
   `PLAN_ULTRA_PRICE` in whole pesos, for example `299`. Without a price the
   plan shows **Coming soon**.
3. **Payments:** PayMongo checkout is the next step (GCash, Maya, cards).
   Until it is connected, nobody can buy a plan on the page.

## Give someone a plan by hand

They must have signed in once. In the Supabase SQL Editor:

```sql
select public.grant_plan('person@example.com', 'ultra', 30);   -- or 'max'; days
```

Do this for yourself to test Max and Ultra. It takes up to a minute to show.

## Turn plans off

`PLANS_ENABLED=false` lets every signed-in user pick every tier, as before.
