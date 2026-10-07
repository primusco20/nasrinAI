# CLAUDE.md — NasrinAI

Read this first in every session. It carries the working rules and current
state that used to live in a claude.ai Project. Details live in `docs/`.

## What this is

NasrinAI: a general, local-first AI assistant ("answers anything"), later
connectable to businesses' own apps (POS, customer service, websites).
Started from the Crazy Bite smart-chat code (`reference/crazybite-chat`,
read-only reference). Not an ordering/delivery chat anymore.

- Repo: `primusco20/nasrinAI`. Live: https://nasrinai.com (Vercel).
- Database: its own Supabase project (not shared with Crazy Bite).
- The owner works mostly from a phone: keep changes small and reviewable,
  explain in plain words, give exact copy-paste steps for anything they must
  do in Vercel or Supabase.

## Rules (always)

1. **Inspect before changing.** Read the code and docs; never invent files,
   endpoints, env vars, model IDs or prices. If something can't be confirmed
   from the repo, say "I cannot verify this from the repository."
2. **Git is the source of truth.** Only `main` (live) and `development` are
   permanent. Work on a short branch (`feature/`, `fix/`, `security/`,
   `experiment/`), kept local to the session: merge it into `development`,
   push only `development`, then PR `development` → `main`. Do not push work
   branches to GitHub, and do not turn on GitHub's "Automatically delete head
   branches" (it would delete `development` after each release PR). Releases are tags
   (`v1.0.0`), not branches. Never work directly on `main`, never force-push or
   rewrite history, never delete `main`/`development`, and never delete any
   other branch without the owner's OK. Before changing anything, check and
   state: current branch, uncommitted changes, target branch, planned
   changes, effect on the live site.
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
9. **Legal docs follow every change** (owner's request): when a change affects
   what data is collected, kept, shared or for how long, or what users can do,
   update `public/legal/privacy.md` / `terms.md` in the same change and bump
   the version (`LEGAL_*_VERSION` defaults in `src/config.js`); a new Terms
   version makes signed-in users accept again.

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
- `src/ai/professions.js`, `src/ai/professional.js` — Professional AI registry and orchestrator (`docs/professional.md`).
- `src/chat.js` — one chat turn: streaming (NDJSON), Stop, Regenerate, Edit (`docs/chat.md`).
- `src/notices.js` + `config/notices.json` — in-app notices (`docs/notices.md`).
- `src/library.js` — the Library: people's own text files, notes, saved replies (`docs/library.md`, migration 012).
- `src/projects.js` — Projects: instructions, tasks, scoped chats and Library items (`docs/projects.md`, migration 013).
- `src/storage.js` — Library as storage: lists/deletes a person's chats, files, sent photos/files and pictures, keeps sent files, and applies their keep-time (`prefs.retention`; migration 014; `docs/library.md`).
- `src/tools/` — tool engine (Phase 5): registry, argument checks, first tools (`docs/tools.md`).
- `src/connectors/` — business REST/GraphQL connectors (Phase 6): definition checks, encrypted keys, SSRF-safe calls (`docs/connectors.md`).
- `src/knowledge/` — business knowledge (full-text search, audience) and confirmed user memory (`docs/knowledge.md`).
- `scripts/eval/` + `test/redteam.test.js` — Phase 9 live suites and attack tests (`docs/red-team.md`).
- `scripts/teacher/` — Phase 8 dataset pipeline, owner-run (`docs/teacher.md`).
- `src/channels/facebook.js` — Messenger: signed webhook, Page tokens encrypted, answers as the Page's business (`docs/facebook.md`).
- `src/auth/` — server-side Supabase Auth: email code + Google (`docs/sign-in.md`).
- `src/plans.js`, `src/payments/` — prepaid 30-day Max/Ultra via PayMongo
  (`docs/plans.md`).
- `src/legal.js` — terms acceptance, export, delete (`docs/compliance/`).
- `src/settings.js` — privacy choices (memory) in Supabase user metadata; `/v1/usage`, `/v1/billing` in `src/routes.js` (Settings pages).
- `src/store/` — memory store (tests) and Supabase store.
- `db/migrations/00N_*.sql` + `db/tests/` — run in order in the Supabase SQL
  editor; every migration gets a DB test.
- `public/` — the app (plain JS/CSS), `format.js` (safe Markdown), legal pages.

## Current state (2026-10-08)

| Phase | Status |
|---|---|
| 0 Discovery · 1 Security · 2 Provider layer · 3 Local model | Done |
| 4 Router + image creation | Done: router, cost-aware routing, pictures (questions → brief → picture → Download/Regenerate), picture tiers with fallbacks, separate picture budget, plan-based picture allowance, chat history. Waiting: live-key test, user-image retention decision |
| 5 Tools | Done: registry, checks, read-only tools, chat runs tools, Confirm card for write/money |
| 6 Connectors | Done: REST, GraphQL, OAuth 2.0 (010), Messenger (007), signed webhooks (008); a named POS when chosen |
| 7 Knowledge + memory | Done (migration 009); knowledge-only businesses (011) |
| 8 Teacher pipeline | Done (scripts/teacher, no customer data) |
| 9 Eval/red team | Done |
| 10 Hardening | Done (secret scan in CI, retention setting, `docs/operations.md`) |
| Compliance track | Audit, draft Terms/Privacy, acceptance, export/delete done; business inputs pending |
| Upgrade phases A–G | Done: A Professional AI, B opt-in memory, C chat (streaming, Stop, Retry, Edit, Regenerate, read-aloud Pause), D in-app notices, E Library (012), F Projects (013), G Coding (since removed; the Library is now a storage view, migration 014). All upgrade phases done |\n| NasrinAI Connect | In progress on `feature/nasrinai-connect-v1`: safe website discovery, authorization, installation state machine, provider registry, explicit approval, live verification and rollback contract. Not merged to `main`. |

Full plan: `docs/roadmap.md`.

PR #17 (smart routing, web, pictures, privacy and terms) is merged into
`main`. Migrations `003_routing.sql`, `004_images.sql`, `005_legal.sql` must
be run in Supabase. Rollback switches: `TOOLS_ENABLED=false`, `ROUTING=fixed`, empty
`WEB_SEARCH_MODEL`, unset `GEMINI_API_KEY`, `LEGAL_REQUIRE_TERMS=false`.

`main` and `development` are level (all work merged). Branch audit done
2026-10-05: every other branch is merged into `main`, except the Vercel bot's
Web Analytics branch (not wanted: adds an npm package).

Not yet tested against live services: Gemini image generation, OpenAI web
search, GPT‑6 models with the owner's key.

## NasrinAI Connect working rule\n\nConnect is a no-code customer experience backed by a strict authorization boundary. A URL is discovery only; it is never permission to modify a site. Every write-capable provider must require explicit authorization and approval, return a deployment receipt, pass live verification before activation, and support rollback. Provider credentials never enter model context. Update `docs/nasrinai-connect.md` whenever Connect architecture, API, lifecycle, provider methods or security guarantees change.\n\n## Next up

1. Try pictures with the live keys.
2. Owner: run migration 006, set `CONNECTOR_SECRET_KEY`. Run migrations 007–013 and the Meta app setup (`docs/facebook.md`). Next code: POS connector (owner names the POS). Portfolio chat: tenant + keys + `knowledge_only` (`docs/knowledge.md`).
3. Owner decisions in `docs/compliance/README.md` (business name/address,
   emails, refunds, retention, minimum age, DPO, BIR receipts, Gemini paid
   tier before customer photos).
6. Plan prices (`PLAN_MAX_PRICE`, `PLAN_ULTRA_PRICE`) still to be decided.

## Owner decisions on record

- Guests can chat without signing in; models shown as NasrinAI, Pro, Max,
  Ultra (never raw model names). Guests get NasrinAI and Pro.
- Hosting on Vercel; sign-in by email code and Google; payments by PayMongo.
- Logo: a ball with two pill-shaped eyes; monochrome, off-white look; the
  logo is an animated mood character.
- Type: keep the soft rounded font for headings (`--round` in `public/app.css`:
  SF Pro Rounded on Apple devices); body text in the system font; no heavy
  bold or oversized text.
- Images: Gemini as the cheap default (swappable), one image per request.
- Signed-in users' pictures are kept 30 days.
- Identity: NasrinAI, created by Nasrin Abubakar. Never presented as Google's,
  OpenAI's or another company's product (`src/ai/prompt.js`, `keepIdentity` in `src/ai/output.js`).
- Questions about the founder are answered from the public portfolio
  (`FOUNDER_KNOWLEDGE_URL`, `src/knowledge/founder.js`); no personal details of
  other people.


### Connect milestone — SmartChat V1
- Branch: `feature/nasrinai-connect-v1` (do not merge to main without owner approval).
- `public/connect/smartchat.js` is the first public widget runtime. It uses only an origin-locked publishable `nsp_` key; no secret key is embedded in customer pages.
- Guest sessions issued for Connect are bound to the requesting HTTPS origin and rejected when replayed from another origin.
- Widget installation is still behind explicit Connect authorization; URL discovery alone never grants write access.
- Keep Connect changes synchronized with `docs/nasrinai-connect.md`.

- Connect activation provisions the origin-locked `nsp_` widget key server-side after authorization; secret keys are never exposed to the widget.

- Connect dashboard status must distinguish discovery, authorization, readiness, activation, failure, pause, and removal; never infer installation from URL analysis.

- Connect invariant: **key provision is not installation**. A widget key must never cause an installation to be reported active without provider installation and live verification.

- Connect workspace is customer-facing and no-code: add/analyze/authorize/activate/remove. Never expose provider credentials or claim Active without backend verification.
