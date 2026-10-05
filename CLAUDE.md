# CLAUDE.md — NasrinAI

Read this first in every session. It carries the working rules and current
state that used to live in a claude.ai Project. Details live in `docs/`.

## What this is

NasrinAI: a general, local-first AI assistant ("answers anything"), later
connectable to businesses' own apps (POS, customer service, websites).
Started from the Crazy Bite smart-chat code (`reference/crazybite-chat`,
read-only reference). Not an ordering/delivery chat anymore.

- Repo: `primusco20/nasrinAI`. Live: https://nasrinai.site (Vercel).
- Database: its own Supabase project (not shared with Crazy Bite).
- The owner works mostly from a phone: keep changes small and reviewable,
  explain in plain words, give exact copy-paste steps for anything they must
  do in Vercel or Supabase.

## Rules (always)

1. **Inspect before changing.** Read the code and docs; never invent files,
   endpoints, env vars, model IDs or prices. If something can't be confirmed
   from the repo, say "I cannot verify this from the repository."
2. **Git is the source of truth.** Work on `feature/*` branches → merge into
   `development` → PR `development` → `main`. Never force-push, rewrite
   history, or delete `main`/`development`.
3. **Never commit or print secrets**: API keys, tokens, private keys, DB
   dumps, customer data. Mask values in output (`sk-proj-********`). Don't
   rotate secrets on your own.
4. **Small increments**: one concern per change; don't touch unrelated files.
5. **Security posture**: never trust the client; the AI model is untrusted
   (output is cleaned, it can't act on its own); no automatic training on
   customer data. Never claim "unhackable", "100% secure" or "compliant".
6. **Legal/business facts are the owner's**: use `[REQUIRES INPUT]`-style
   placeholders, never make up business name, address, prices or policies.
7. **Zero runtime dependencies** (ADR-002): Node 22 built-ins only.
8. **Minimal replies** (owner's request, to save tokens): a few lines only —
   what changed, exact owner steps if any, what is needed. No summaries,
   tables or explanations unless asked. Put the effort into correct, tested
   code instead. Stop for approval before starting a new phase.

## Commands

```bash
npm test                    # all server tests (node --test), must stay green
AI_PROVIDER=fake npm start  # local run on http://localhost:10000, no keys needed
                            # (env vars come from the shell; see .env.example)
node scripts/simulate-routing.js   # cost simulation for smart routing
```

Database tests need a Postgres 16 (CI uses a service container):

```bash
PGHOST=... PGPORT=... PGUSER=postgres bash db/tests/run.sh
```

CI (`.github/workflows/ci.yml`) runs `npm test` and the DB tests on every
push and PR. Vercel builds a preview for every PR.

## Map

- `server.js`, `api/index.js` (Vercel function; `vercel.json` rewrites).
- `src/config.js` — every env var is parsed and validated here. Misconfigured
  optional features turn off with a warning; they must not crash the site.
- `src/main.js` — wiring. `src/routes.js` — HTTP routes. `src/http/` — app,
  body parsing, static files (strict CSP: `'self'` only, no inline scripts).
- `src/ai/` — providers (`openai`, `local`, `gemini`, `fake`), `router.js`
  (fallback, redaction for outside models), smart routing: `classify.js`
  (levels 1–5), `logic.js` (tier 0, no model), `policy.js`, `budget.js`,
  `pricing.js` + `config/model-prices.json`. See `docs/routing.md`.
- `src/web/` — SSRF-safe link reader and web search (`docs/web.md`).
- `src/images.js`, `src/ai/image.js` — pictures: tiers (`IMAGE_TIER_n_*`), Gemini / GPT Image, own budget.
- `src/tools/` — tool engine (Phase 5): registry, argument checks, first tools (`docs/tools.md`).
- `src/connectors/` — business REST/GraphQL connectors (Phase 6): definition checks, encrypted keys, SSRF-safe calls (`docs/connectors.md`).
- `src/knowledge/` — business knowledge (full-text search, audience) and confirmed user memory (`docs/knowledge.md`).
- `src/channels/facebook.js` — Messenger: signed webhook, Page tokens encrypted, answers as the Page's business (`docs/facebook.md`).
- `src/auth/` — server-side Supabase Auth: email code + Google (`docs/sign-in.md`).
- `src/plans.js`, `src/payments/` — prepaid 30-day Max/Ultra via PayMongo
  (`docs/plans.md`).
- `src/legal.js` — terms acceptance, export, delete (`docs/compliance/`).
- `src/store/` — memory store (tests) and Supabase store.
- `db/migrations/00N_*.sql` + `db/tests/` — run in order in the Supabase SQL
  editor; every migration gets a DB test.
- `public/` — the app (plain JS/CSS), `format.js` (safe Markdown), legal pages.

## Current state (2026-10-05)

| Phase | Status |
|---|---|
| 0 Discovery · 1 Security · 2 Provider layer · 3 Local model | Done |
| 4 Router + image creation | Done: router, cost-aware routing, pictures (questions → brief → picture → Download/Regenerate), picture tiers with fallbacks, separate picture budget, plan-based picture allowance, chat history. Waiting: live-key test, user-image retention decision |
| 5 Tools | Done: registry, checks, read-only tools, chat runs tools, Confirm card for write/money |
| 6 Connectors | REST + GraphQL connectors (006), Messenger (007), signed webhooks + events tool (008); next: a named POS |
| 7 Knowledge + memory | Done (migration 009) |
| 8 Teacher pipeline · 9 Eval/red team · 10 Hardening | Not started |
| Compliance track | Audit, draft Terms/Privacy, acceptance, export/delete done; business inputs pending |

Full plan: `docs/roadmap.md`.

PR #17 (smart routing, web, pictures, privacy and terms) is merged into
`main`. Migrations `003_routing.sql`, `004_images.sql`, `005_legal.sql` must
be run in Supabase. Rollback switches: `TOOLS_ENABLED=false`, `ROUTING=fixed`, empty
`WEB_SEARCH_MODEL`, unset `GEMINI_API_KEY`, `LEGAL_REQUIRE_TERMS=false`.

PR #19 (`development` → `main`) is open; no database change.

Not yet tested against live services: Gemini image generation, OpenAI web
search, GPT‑6 models with the owner's key.

## Next up

1. Merge PR #19; try pictures with the live keys.
2. Owner: run migration 006, set `CONNECTOR_SECRET_KEY`. Run migrations 007, 008 and 009 and the Meta app setup (`docs/facebook.md`). Next code: POS connector (owner names the POS).
3. Owner decisions in `docs/compliance/README.md` (business name/address,
   emails, refunds, retention, minimum age, DPO, BIR receipts, Gemini paid
   tier before customer photos).
4. Google logo on "Continue with Google": waiting for the official asset
   from the owner (don't draw it).
5. How long signed-in users' pictures are kept (suggested 30 days).
6. Plan prices (`PLAN_MAX_PRICE`, `PLAN_ULTRA_PRICE`) still to be decided.

## Owner decisions on record

- Guests can chat without signing in; models shown as NasrinAI, Pro, Max,
  Ultra (never raw model names). Guests get NasrinAI and Pro.
- Hosting on Vercel; sign-in by email code and Google; payments by PayMongo.
- Logo: a ball with two pill-shaped eyes; monochrome, off-white look; the
  logo is an animated mood character.
- Images: Gemini as the cheap default (swappable), one image per request.
