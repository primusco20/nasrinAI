# Security

How NasrinAI handles the problems found in the Phase 0 audit of the original
Nasrin chat, and what is still open. Nothing here makes NasrinAI "unhackable";
the aim is to prevent, limit, detect and recover.

## Audit findings, as of Phase 3

| Finding in the original code | How NasrinAI handles it | Where |
| --- | --- | --- |
| H2 AI and voice endpoints open to anyone, no spend cap | Every model call needs a signed-in user, a guest session or a business key. Hourly limits per caller and per IP; daily token budgets per guest pool, user and business. The voice endpoint can only read Nasrin's own replies in the caller's conversation, or one fixed sample line, so it cannot be used as a free text-to-speech service; it has its own hourly limits and counts against the daily budget | `src/gateway/`, `src/limits.js` |
| M1 Browser sends the chat history | History is read from the database; anything else in the request body is ignored | `src/chat.js` |
| M2 Rate limits counted per server instance | Counters live in the database (`rate_hit`), shared by all instances | `db/migrations/001_core.sql` |
| M3 Customer text sent to an outside model without notice | Emails, phone and card numbers removed from what an outside model sees; the page states where messages go | `src/ai/redact.js`, `public/app.js` |
| M4 Inline-script CSP with tokens in browser storage | Page CSP allows only the site's own script and styles, no inline code; messages rendered as text only | `src/http/headers.js`, `public/` |
| M5 No tests or CI | Server tests (97 at Phase 3) and database access-rule tests run in CI on every push | `test/`, `db/tests/`, `.github/workflows/ci.yml` |
| M6 No record of AI use | One usage row per model call: tokens, latency, outcome, no text | `usage_events`, `src/limits.js` |
| H1 Support desk can be claimed by anyone | Not applicable: NasrinAI has no call desk. Still open in the Crazybite app | Crazybite repo |

## Controls in place

- **Fail closed:** unknown credentials, unreadable counters, a missing tenant or a suspended business all refuse the request.
- **Tenant from the credential only:** `tenant_id` and the actor are never read from the request body.
- **Database:** RLS on every table, no grants to `anon` or `authenticated`; only the server's service-role key can read or write. Business secret keys are stored as SHA-256 hashes; key creation is possible only in the SQL Editor.
- **Conversations:** owned by one caller; anyone else gets 404.
- **Input and output:** JSON bodies capped at 16 KB (the chat route: 4.1 MB for files); messages at 4,000 characters; model replies cleaned of control characters and capped.
- **Files:** photos, PDFs and UTF-8 text only, decided by the file's first bytes, never its name. At most 4 files and 3 MB per message. Photos are re-drawn as JPEG on the phone, which also drops location and camera details. Files are used for one reply and not stored; the saved message keeps their names. Text files are redacted like messages; photos and PDFs cannot be, so they reach the outside model as sent.
- **Voice:** `POST /v1/speech` takes a voice from a fixed list and either a reply id (checked for ownership first; someone else's is 404) or `preview: true` for a fixed line. Text from the request is never spoken. Limited per caller (`LIMIT_*_SPEECH_HOUR`) and per IP, counted in the daily budget and in `usage_events`. Audio is kept in server memory briefly so replays are free; it is not stored.
- **Sign-in:** the page talks only to NasrinAI's server; the server talks to Supabase Auth with the public key. The refresh token lives in an HttpOnly, Secure, SameSite=Strict cookie limited to `/v1/auth`; page scripts never see it, and the access token (one hour) is kept in memory only. Cookie routes refuse cross-site requests (`Sec-Fetch-Site` and `Origin` checks) and CORS never allows credentials. Google uses PKCE with the verifier in a short-lived HttpOnly cookie. Codes are limited per IP and per address (hashed), attempts per address. Supabase's messages are never shown to the page.
- **Own model (Phase 3):** in production a model server on another machine needs `https://` and a credential (bearer key or Cloudflare Access service token), or the server will not start. Credentials in the URL are refused. The browser never learns the model server's address. Its health is checked at most every 30 seconds. See [ADR-004](decisions/004-local-model-runtime.md).
- **Errors:** callers see a plain message and a request id; details stay in the server log. Logs redact anything that looks like a credential.
- **Headers:** CSP, HSTS (production), X-Frame-Options DENY, nosniff, no referrer, Permissions-Policy.
- **Supply chain:** no third-party runtime packages ([ADR-002](decisions/002-no-runtime-dependencies.md)).
- **Configuration:** the server will not start with missing production settings, a short guest secret, or Supabase keys in the wrong slots.

## Known limits

- Guests can use the AI without signing in, up to `GUEST_DAILY_TOKEN_CEILING` per day in total. A bot check is the next step if abuse appears.
- Rate limits use fixed hourly windows, so a burst at the turn of an hour can reach up to twice the limit.
- Budgets are checked before each model call; several calls at the same moment can go slightly over.
- Daily budgets count tokens, not money. A signed-in user who picks Max or Ultra uses the same token budget at a much higher cost per token. `TIERS_USER` and the `TIER_*` settings control what is offered; the OpenAI spending cap is the backstop.
- Natural-voice audio is billed per character by OpenAI; the token budget counts it only roughly (characters / 4).
- With an own model, what the model server and tunnel log is outside NasrinAI's control.
- A signed-in user's token is trusted for up to 30 seconds after sign-out (short cache).
- Revoking a publishable key stops new widget guest sessions; guests already started keep chatting until their session ends (24 hours by default).
- CORS reflects any origin, without credentials. Access is decided by the credential, and for publishable keys by the origin check at session start.
- Supabase's built-in email sender is for testing only (few emails, team addresses); real users need custom SMTP.
- Two tabs renewing the sign-in at the same moment can sign one of them out (Supabase rotates refresh tokens).
- Tested against a local PostgreSQL copy of Supabase's roles, not yet against the live project. Not yet penetration tested.
