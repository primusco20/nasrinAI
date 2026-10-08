# Smart routing: the cheapest model that can do the job

Each message goes to the **cheapest model that can answer it well**. Strong
models are used when the message needs them, never just because they exist.
The user still sees one assistant, Nasrin.

```
message ─▶ can code answer it? ──yes──▶ answer (no model, no cost)
              │ no
              ▼
           what does it need? (task, level 1–5, private data?)
              ▼
           cheapest candidate at that level that is allowed:
             • within the tier's range (Quick 1–2, Pro 1–3, Max 1–4, Ultra 1–5)
             • private data never goes to a service that trains on it
             • the price is known and fits the budget (else a lower level)
              ▼
           call ─▶ answer empty or cut off? ─▶ one level up (bounded)
              │      model down? ─▶ next candidate at the same level, or the same
              │                     model once more after 1.5 s (bounded by MAX_RETRIES)
              ▼
           answer + telemetry (task, level, model, tokens, cost; no text)
```

## Levels and models

| Level | Meant for | Default candidates (cheapest first) |
| --- | --- | --- |
| 0 | Arithmetic, percentages, email-format checks | Code, no model |
| 1 | Chat, translation, short writing, simple support | own model (auto/local), `gemini-3.1-flash-lite`, `gpt-6-luna` |
| 2 | Simple code, analysis, longer writing | `gpt-6-luna` (low reasoning) |
| 3 | Debugging, careful technical work | `gpt-5.6-terra` (medium) |
| 4 | Architecture, security design, big refactors | `gpt-6.1-sol` (high) |
| 5 | Whole-system redesigns, long-horizon planning | `gpt-6-astra` (high) |

**Coding specialist lane:** Claude is not part of the general levels. **Max** uses Claude Sonnet 5.5 for coding/debugging. **Ultra** uses Sonnet 5.5 for levels 2-3 and upgrades to Claude Opus 5.5 only for levels 4-5. If Anthropic is unavailable or fails, routing falls back to the normal same-level provider pool. This is a hard tier/task gate, so `ROUTE_LEVEL_n` overrides cannot expose Claude to Quick/Pro or to non-coding work.

Model ids were checked against OpenAI's and Google's model pages on
2026-10-05. `gpt-5` and `gpt-5-mini` are marked deprecated there, so they
are no longer defaults. Change any level with `ROUTE_LEVEL_n`; ids appear
nowhere else in the code.

The tier a person picks sets **how high** routing may go, not where it starts.
"hi" on Ultra is still answered by a level-1 model.

## Budgets

Spending is estimated from token counts and `config/model-prices.json`, and
kept in `usage_events.cost_usd`.

| Setting | Default | |
| --- | --- | --- |
| `DAILY_BUDGET_USD` | 0.25 | Manila day |
| `WEEKLY_BUDGET_USD` | 1 | last 7 days (the target) |
| `MONTHLY_BUDGET_USD` | 4 | last 30 days |
| `MAX_REQUEST_COST_USD` | 0.05 | one message; dearer levels are stepped down |

Pictures have their own limits (`IMAGE_DAILY_BUDGET_USD` 1, `IMAGE_WEEKLY_BUDGET_USD` 5,
`IMAGE_MONTHLY_BUDGET_USD` 15): picture spending never uses up the chat budget, and chat
spending never blocks pictures.

When a message would go over a limit, the router tries a cheaper level. When
nothing fits, Nasrin says the limit is reached instead of spending. Free
models (Gemini free tier, own model) keep answering public questions. If the
spend cannot be read, only the cheapest level is used.

With the defaults, levels 4–5 cost more than $0.05 per message and are
stepped down to level 3. Raise `MAX_REQUEST_COST_USD` (and the budgets) when
paid plans cover the cost.

## Saving tokens

- History sent per level: 6k characters at level 1, up to 32k at level 5.
- Reply allowance per level: 700 tokens at level 1, up to 3,200 at level 5.
- The system prompt is the same first block every time, so providers that
  cache prompts can reuse it; cached tokens are recorded.
- The same first, public, simple question is answered from memory for
  `RESPONSE_CACHE_MINUTES` (never with contact details, files or history).

## Watching it

Run [migration 003](../db/migrations/003_routing.sql), then in the Supabase
SQL Editor:

```sql
select * from public.routing_daily order by day desc, cost_usd desc;
```

It shows calls, successes, escalations, cache hits, tokens, cost and cost per
successful answer by day, level, task and model. If one task category
fails or escalates often at a level, move it up; if a cheap model handles a
category well, keep it there. The 90 / 7 / 2.5 / 0.5 % split is a goal to
watch, not a rule to force.

## Cost simulation

`node scripts/simulate-routing.js` runs a synthetic workload (1,000 simple,
100 moderate, 25 complex, 5 extreme messages) through the real classifier,
ranges and prices with assumed token sizes. The token sizes are guesses;
compare them with `routing_daily` once there is real traffic.

## Turning it off

`ROUTING=fixed` goes back to one model per tier (`TIER_*`).


## Multi-provider routing baseline (2026-10-09)

NasrinAI is capability-first and provider-agnostic. The routing order is:

1. classify intent/task complexity
2. constrain by the caller's Quick/Pro/Max/Ultra tier range
3. apply privacy and provider-policy constraints
4. choose the cheapest capable configured candidate
5. fail over or escalate within bounded limits
6. validate the result and record telemetry/cost

Current candidate family:

- General Level 1: Gemini 3.1 Flash-Lite, GPT-6 Luna
- General Level 2: GPT-6 Luna
- General Level 3: GPT-5.6 Terra
- General Level 4: GPT-6.1 Sol
- General Level 5: GPT-6 Astra
- Max coding/debugging: Claude Sonnet 5.5
- Ultra coding/debugging: Claude Opus 5.5

The exact general candidates remain configuration-driven through `ROUTE_LEVEL_1` through `ROUTE_LEVEL_5`. Claude is a separate capability route, not a general fallback.

Privacy is a routing constraint, not a pricing optimization. Sensitive content must not be routed to a provider whose configured policy indicates training on submitted data. Tool-dependent requests are kept off the current Anthropic adapter until its tool-format bridge is explicitly enabled.

Image and video are separate capability routes. Image generation keeps its own tier/budget controls. Video remains asynchronous/Ultra-only and uses Gemini Veo 3.1 Standard by default for final quality; Veo 3.1 Fast is the lower-cost operator choice. OpenAI's Sora 2 API is not a production option because OpenAI removed the Sora 2 API/Videos API on September 24, 2026.

Provider pricing is stored in config/model-prices.json; production budgets must be reviewed whenever provider pricing changes. Claude Sonnet 5.5 is $2/$10 and Opus 5.5 is $4/$20 per million input/output tokens. Gemini's Veo 3.1 Standard is $0.40/sec at 720p/1080p, while Veo 3.1 Fast is $0.10/sec at 720p. Gemini's current pricing page also lists Gemini Omni Flash at about $0.10/sec for 720p video, but NasrinAI's current production adapter is Veo-based, so Omni should be introduced through a dedicated adapter rather than by swapping a model string.
