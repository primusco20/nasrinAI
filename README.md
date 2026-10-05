# nasrinAI

NasrinAI is a local-first AI assistant: people can ask it anything, and
businesses can connect it to their own websites, apps, POS and customer service.

**Status:** Phases 1–3 are on the `development` branch: a secured API,
guest and business access, server-side conversations, OpenAI and local-model
providers behind one provider interface, and a mobile chat page. Phase 4
(the router that combines local and GPT models, then AI image creation) is
next; see the [roadmap](docs/roadmap.md).

## Run it

Needs Node.js 22 or newer. There is nothing to install.

```
npm test                       # every server test
AI_PROVIDER=fake npm start     # local test run on http://localhost:10000, no keys needed
```

Without database settings the server keeps data in memory (development only).
To deploy, see [docs/deploy-vercel.md](docs/deploy-vercel.md); for sign-in,
[docs/sign-in.md](docs/sign-in.md). To answer with
your own model, see [docs/local-model.md](docs/local-model.md).

## API

All `/v1` routes except status, guest sessions and sign-in need `Authorization: Bearer <credential>`.

| Route | What it does |
| --- | --- |
| `GET /v1/status` | Is the AI on, is it NasrinAI's own model or an outside one, which files and natural voices it supports |
| `POST /v1/guest/sessions` | Starts a guest session (with `X-NasrinAI-Key` from a business website: a guest of that business) |
| `POST /v1/auth/email/start`, `/v1/auth/email/verify` | Sign in with an emailed code (page only; sets the sign-in cookie) |
| `GET /v1/auth/google/start` | Sign in with Google (when `AUTH_GOOGLE=true`) |
| `POST /v1/auth/refresh`, `/v1/auth/sign-out` | Renew the access token from the cookie; sign out |
| `GET /v1/plans` | Free, Max and Ultra plans, their prices, and your plan |
| `POST /v1/plans/checkout` | `{ plan }` → a PayMongo checkout link (signed-in users) |
| `POST /v1/payments/paymongo` | PayMongo's payment webhook (signature-checked) |
| `GET /v1/models` | The tiers this caller may pick (NasrinAI, Pro, Max, Ultra), and the default |
| `POST /v1/chat` | `{ message, conversation_id?, model?, attachments? }` → the reply (`model` is a tier id; `attachments`: photos, PDFs, text files as base64) |
| `POST /v1/images/brief` | `{ prompt, photo?, answers? }` → up to 5 adaptive questions, or the creative brief and its summary |
| `POST /v1/images` | `{ prompt, photo?, brief?, conversation_id? }` → one picture (built from the brief when given); send it again to regenerate |
| `GET /v1/images/:id` | A picture, only for the person who made it |
| `POST /v1/speech` | `{ voice, message_id }` → MP3 of one of Nasrin's replies in your conversation; `{ voice, preview: true }` → a fixed sample line. Nothing else can be spoken |
| `GET /v1/conversations` | Your conversations |
| `GET /v1/conversations/:id/messages` | One conversation's messages |
| `DELETE /v1/conversations/:id` | Deletes a conversation |
| `GET /v1/whoami` | Which caller the credential is |
| `POST /v1/actions/confirm`, `/v1/actions/cancel` | `{ token }` → run or drop an action Nasrin proposed (write/money tools) |
| `GET/POST /v1/webhooks/facebook` | Messenger webhook (Meta-signed; see [docs/facebook.md](docs/facebook.md)) |
| `GET/PUT/DELETE /v1/channels/facebook[/:page_id]` | A business connects its Facebook Page (secret key with `connectors` scope) |
| `POST /v1/hooks/:tenant/:connector` | Signed events from a business's system (POS, shop); see [docs/connectors.md](docs/connectors.md) |
| `POST/DELETE /v1/connectors/:name/webhook` | Turn a connector's webhook on (secret shown once) or off |
| `GET/PUT/DELETE /v1/connectors[/:name]` | A business's own API connectors (secret key with the `connectors` scope; see [docs/connectors.md](docs/connectors.md)) |

## Layout

| Path | What it is |
| --- | --- |
| `server.js` | Starts the HTTP server (local runs and other hosts) |
| `api/index.js` | The same app as a Vercel function |
| `src/` | Gateway, limits, conversations, chat, AI providers |
| `public/` | The chat page |
| `db/` | Database migration and its tests |
| `test/` | Server tests (`node:test`) |
| `docs/` | [Roadmap](docs/roadmap.md), [security](docs/security.md), [database](docs/database.md), [deployment](docs/deploy-vercel.md), [decisions](docs/decisions/), [planned features](docs/features/) |
| `reference/crazybite-chat/` | The original Nasrin code, unchanged, for reference only |

## Decisions

- [ADR-001: Access model and hosting](docs/decisions/001-access-and-hosting.md)
- [ADR-002: No third-party runtime packages](docs/decisions/002-no-runtime-dependencies.md)
- [ADR-003: Host the API on Vercel](docs/decisions/003-host-on-vercel.md)
- [ADR-004: Local model runtime](docs/decisions/004-local-model-runtime.md)
