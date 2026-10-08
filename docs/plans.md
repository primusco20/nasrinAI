# Plans: Max and Ultra

Signed-in users get Quick and Pro for free. **Max** and **Ultra** come with
a plan:

| Plan | Tiers | Price |
| --- | --- | --- |
| Free | Quick, Pro | ₱0 |
| Max | Quick, Pro, Max | `PLAN_MAX_PRICE` per 30 days; `PLAN_MAX_ANNUAL_PRICE` per 365 days when configured |
| Ultra | Quick, Pro, Max, Ultra | `PLAN_ULTRA_PRICE` per 30 days; `PLAN_ULTRA_ANNUAL_PRICE` per 365 days when configured |

A plan is a 30-day period. Paying again before it ends adds 30 days after the
current period, so no days are lost. Business keys are not limited by plans.

## Set it up

1. **Database:** in Supabase **SQL Editor**, run
   [`db/migrations/002_plans.sql`](../db/migrations/002_plans.sql) once.
   Until then every signed-in user is treated as Free (chat still works).
2. **Prices (when you decide):** in Vercel add the 30-day prices `PLAN_MAX_PRICE` and
   `PLAN_ULTRA_PRICE` in whole pesos. Annual checkout is enabled separately by
   setting `PLAN_MAX_ANNUAL_PRICE` and `PLAN_ULTRA_ANNUAL_PRICE` in whole pesos.
   Without a price, that billing option is unavailable and cannot be purchased.
3. **Payments:** connect PayMongo (below). Until it is connected, plans show
   their price but nobody can buy one on the page.

## Connect PayMongo (GCash, Maya, cards)

Start in **test mode**; switch to live keys once PayMongo has activated your
account.

1. **PayMongo dashboard > Developers > API keys:** copy the **secret key**
   (`sk_test_…`). It goes only into Vercel, as a sensitive variable.
2. **Developers > Webhooks > Create webhook:**
   - URL: `https://nasrinai.site/v1/payments/paymongo`
   - Event: `checkout_session.payment.paid`
   - Copy the webhook's **secret** (`whsk_…`).
3. **Vercel > Settings > Environment Variables:**

   | Name | Value |
   | --- | --- |
   | `PAYMONGO_SECRET_KEY` | `sk_test_…` (sensitive) |
   | `PAYMONGO_WEBHOOK_SECRET` | `whsk_…` (sensitive) |
   | `SITE_URL` | `https://nasrinai.site` |
   | `PLAN_MAX_PRICE`, `PLAN_ULTRA_PRICE` | whole pesos, e.g. `299` |
   | `PAYMONGO_METHODS` | optional, default `gcash,paymaya,card` |

4. Redeploy, sign in, open **Settings > See plans** and tap **Get Max**. In
   test mode PayMongo shows test payment screens; nothing is charged.
5. Back on NasrinAI, your plan shows within a minute.

How a payment is checked: PayMongo's webhook must carry a valid signature,
and the server then asks PayMongo for the checkout again with its own key.
The plan is recorded only if PayMongo says the full price was paid, for the
plan and the account that started the checkout. Each checkout counts once.

Going live: replace both values with the live secret key (`sk_live_…`) and the
live webhook's secret. Test-mode events are then ignored.

## Give someone a plan by hand

They must have signed in once. In the Supabase SQL Editor:

```sql
select public.grant_plan('person@example.com', 'ultra', 30);   -- or 'max'; days
```

Do this for yourself to test Max and Ultra. It takes up to a minute to show.

## Turn plans off

`PLANS_ENABLED=false` lets every signed-in user pick every tier, as before.
