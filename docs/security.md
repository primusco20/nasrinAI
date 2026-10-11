# Security

How NasrinAI handles the problems found in the Phase 0 audit of the original
Nasrin chat, and what is still open. Nothing here makes NasrinAI "unhackable";
the aim is to prevent, limit, detect and recover.

## Audit findings, as of Phase 3

| Finding in the original code | How NasrinAI handles it | Where |
| --- | --- | --- |
| H2 AI and voice endpoints open to anyone, no spend cap | Routed model calls require an authenticated caller and use atomic token reservations plus a shared PostgreSQL USD reservation ledger. The ledger covers routed model attempts, web search, image generation, generated speech, video jobs, and browser-direct realtime sessions; it fails closed when a required reservation cannot be made. Realtime and generated media are charged at conservative maximum-use estimates because exact provider billing is not available synchronously. | `src/gateway/`, `src/limits.js`, `src/ai/budget.js`, `db/migrations/025_global_spend_reservations.sql` |
| M1 Browser sends the chat history | History is read from the database; anything else in the request body is ignored | `src/chat.js` |
| M2 Rate limits counted per server instance | Counters live in the database (`rate_hit`), shared by all instances | `db/migrations/001_core.sql` |
| M3 Customer text sent to an outside model without notice | Emails, phone and card numbers removed from what an outside model sees; the page states where messages go | `src/ai/redact.js`, `public/app.js` |
| M4 Inline-script CSP with tokens in browser storage | Page CSP allows only the site's own script and styles, no inline code; messages rendered as text only | `src/http/headers.js`, `public/` |
| M5 No tests or CI | Server tests (97 at Phase 3) and database access-rule tests run in CI on every push | `test/`, `db/tests/`, `.github/workflows/ci.yml` |
| M6 No record of AI use | Usage telemetry records tokens, latency, outcome and estimated cost without message text; the spend ledger records each paid provider attempt and links successful telemetry to avoid double-counting. | `usage_events`, `spend_reservations`, `src/limits.js` |
| H1 Support desk can be claimed by anyone | Not applicable: NasrinAI has no call desk. Still open in the Crazybite app | Crazybite repo |

## Controls in place

- **Fail closed:** unknown credentials, unreadable counters, a missing tenant, a suspended business, a missing price for a paid model, or an unavailable USD reservation RPC all refuse the paid operation before the provider call.
- **Shared estimated USD spend:** `reserve_global_spend` takes a transaction-scoped advisory lock per budget kind, so concurrent requests across serverless instances see outstanding reservations before deciding. Model attempts reconcile to reported token usage; unknown/failed provider outcomes retain the reserved estimate. Usage rows reference their reservation so ledger costs are not counted twice. Chat, web search, speech, video and realtime share the reasoning pool; image generation has its own pool. Reservations orphaned by a crashed request are conservatively settled at their held estimate after 15 minutes on the next reservation, rather than releasing potentially billed spend.
- **Tenant from the credential only:** `tenant_id` and the actor are never read from the request body.
- **Database:** RLS on every table, no grants to `anon` or `authenticated`; only the server's service-role key can read or write. Business secret keys are stored as SHA-256 hashes; key creation is possible only in the SQL Editor.
- **Conversations:** owned by one caller; anyone else gets 404.
- **Input and output:** JSON bodies capped at 16 KB (the chat route: 4.1 MB for files); messages at 4,000 characters; model replies cleaned of control characters and capped.
- **Files:** photos, PDFs and UTF-8 text only, decided by the file's first bytes, never its name. At most 4 files and 3 MB per message. Photos are re-drawn as JPEG on the phone, which also drops location and camera details. Files are used for one reply and not stored; the saved message keeps their names. Text files are redacted like messages; photos and PDFs cannot be, so they reach the outside model as sent.
- **Voice:** `POST /v1/speech` takes a voice from a fixed list and either a reply id (checked for ownership first; someone else's is 404) or `preview: true` for a fixed line. Text from the request is never spoken. Limited per caller (`LIMIT_*_SPEECH_HOUR`) and per IP, counted in the daily budget and in `usage_events`. Audio is kept in server memory briefly so replays are free; it is not stored. In a hands-free voice turn (`/v1/chat` with `voice` and `speak_voice`) the server speaks only the reply it is writing for that caller, sentence by sentence, with the same voice list and limits (counted once per reply); request text is still never spoken.
- **Sign-in:** the page talks only to NasrinAI's server; the server talks to Supabase Auth with the public key. The refresh token lives in an HttpOnly, Secure, SameSite=Strict cookie limited to `/v1/auth`; page scripts never see it, and the access token (one hour) is kept in memory only. Cookie routes refuse cross-site requests (`Sec-Fetch-Site` and `Origin` checks) and CORS never allows credentials. Google uses PKCE with the verifier in a short-lived HttpOnly cookie. Codes are limited per IP and per address (hashed), attempts per address. Supabase's messages are never shown to the page.
- **Plans and payments:** Max/Ultra are checked on the server for every message (403 `plan_required`). NasrinAI Connect separately fails closed unless the signed-in account's current plan is Max or Ultra (403 `connect_plan_required`). Connect installation ownership is bound to both the tenant and the signed-in account ID, so accounts sharing the platform tenant cannot read or mutate one another's Connect sites. Plans live in `plan_periods`, writable only by the service role; `grant_plan` can only be run by the owner. PayMongo keys stay on the server. The webhook checks `Paymongo-Signature` (HMAC-SHA256 over `t.body`, timing-safe), then re-reads the checkout from PayMongo and records the plan only if the full amount was paid for the plan and account in the checkout; each checkout id is recorded once. If plans cannot be read, users are treated as Free.
- **Own model (Phase 3):** in production a model server on another machine needs `https://` and a credential (bearer key or Cloudflare Access service token), or the server will not start. Credentials in the URL are refused. The browser never learns the model server's address. Its health is checked at most every 30 seconds. See [ADR-004](decisions/004-local-model-runtime.md).
- **Errors:** callers see a plain message and a request id; details stay in the server log. Logs redact anything that looks like a credential.
- **Headers:** CSP, HSTS (production), X-Frame-Options DENY, nosniff, no referrer, Permissions-Policy.
- **Supply chain:** no third-party runtime packages ([ADR-002](decisions/002-no-runtime-dependencies.md)).
- **Configuration:** the server will not start with missing production settings, a short guest secret, or Supabase keys in the wrong slots.

## Tenant-isolation regression coverage

Cross-chat recall is intended to read only conversations matching the authenticated caller's tenant, actor type, and actor ID. The application-level query is scoped by all three values. The regression suite includes adversarial fixtures for a different account in the same tenant and the same actor ID in a different tenant; private marker strings must never appear in recalled context. This is automated test evidence only and does not replace verification against the live Supabase project or an external penetration test.

## Known limits

- Guests can use the AI without signing in, up to `GUEST_DAILY_TOKEN_CEILING` per day in total. A bot check is the next step if abuse appears.
- Rate limits use fixed hourly windows, so a burst at the turn of an hour can reach up to twice the limit.
- The USD ledger serializes reservations across instances, but it is still an estimate rather than the provider's invoice. Token estimates, provider-side retries, pricing changes, and media usage can make actual charges differ from reserved amounts. Keep provider-side spending limits enabled and review `config/model-prices.json` whenever providers change prices.
- Token quotas still count tokens rather than money, so Max/Ultra can cost more per token. The shared USD ledger is an additional estimated-cost guard; `TIERS_USER` and the `TIER_*` settings control what is offered. Provider-side spending limits remain the final billing backstop.
- Natural-voice speech reserves a conservative per-character USD estimate before each synthesis and charges that estimate because the TTS adapter does not expose reliable billable usage for each result. It remains subject to the shared reasoning USD budget.
- Realtime voice still connects from the browser directly to OpenAI or Gemini. Before returning a short-lived credential, the server reserves and charges a conservative estimate for the full configured OpenAI session duration or the full 30-minute Gemini token/session exposure window. Gemini token expiry does not prove an already-established session ends at that moment. The server cannot verify every turn or reconcile exact usage, so this is not an exact per-turn or invoice-level spending cap.
- Video jobs reserve the maximum chunked generation duration before provider submission; the estimate is charged upfront because the adapter does not return a trustworthy final invoice. Unknown model/resolution pricing fails closed.
- With an own model, what the model server and tunnel log is outside NasrinAI's control.
- A signed-in user's token is trusted for up to 30 seconds after sign-out (short cache).
- Revoking a publishable key stops new widget guest sessions; guests already started keep chatting until their session ends (24 hours by default).
- CORS reflects any origin, without credentials. Access is decided by the credential, and for publishable keys by the origin check at session start.
- Supabase's built-in email sender is for testing only (few emails, team addresses); real users need custom SMTP.
- Two tabs renewing the sign-in at the same moment can sign one of them out (Supabase rotates refresh tokens).
- Tested against a local PostgreSQL copy of Supabase's roles, not yet against the live project. Not yet penetration tested.
