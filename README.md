# nasrinAI

NasrinAI is a local-first AI assistant: people can ask it anything, and
businesses can connect it to their own websites, apps, POS and customer service.

**Status:** Phases 1 and 2 are on the `development` branch: a secured API,
guest and business access, server-side conversations, an OpenAI provider behind
a provider interface, and a mobile chat page. Phase 3 (local model) is next.

## Run it

Needs Node.js 22 or newer. There is nothing to install.

```
npm test                       # every server test
AI_PROVIDER=fake npm start     # local test run on http://localhost:10000, no keys needed
```

Without database settings the server keeps data in memory (development only).
To deploy, see [docs/deploy-vercel.md](docs/deploy-vercel.md).

## API

All `/v1` routes except the first two need `Authorization: Bearer <credential>`.

| Route | What it does |
| --- | --- |
| `GET /v1/status` | Is the AI on, and does a message leave the server |
| `POST /v1/guest/sessions` | Starts a guest session (with `X-NasrinAI-Key` from a business website: a guest of that business) |
| `GET /v1/models` | The tiers this caller may pick (NasrinAI, Pro, Max, Ultra), and the default |
| `POST /v1/chat` | `{ message, conversation_id?, model?, attachments? }` → the reply (`model` is a tier id; `attachments`: photos, PDFs, text files as base64) |
| `GET /v1/conversations` | Your conversations |
| `GET /v1/conversations/:id/messages` | One conversation's messages |
| `DELETE /v1/conversations/:id` | Deletes a conversation |
| `GET /v1/whoami` | Which caller the credential is |

## Layout

| Path | What it is |
| --- | --- |
| `server.js` | Starts the HTTP server (local runs and other hosts) |
| `api/index.js` | The same app as a Vercel function |
| `src/` | Gateway, limits, conversations, chat, AI providers |
| `public/` | The chat page |
| `db/` | Database migration and its tests |
| `test/` | Server tests (`node:test`) |
| `docs/` | [Security](docs/security.md), [database](docs/database.md), [deployment](docs/deploy-vercel.md), [decisions](docs/decisions/) |
| `reference/crazybite-chat/` | The original Nasrin code, unchanged, for reference only |

## Decisions

- [ADR-001: Access model and hosting](docs/decisions/001-access-and-hosting.md)
- [ADR-002: No third-party runtime packages](docs/decisions/002-no-runtime-dependencies.md)
- [ADR-003: Host the API on Vercel](docs/decisions/003-host-on-vercel.md)
