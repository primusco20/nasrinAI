# nasrinAI

NasrinAI is a local-first AI assistant: people can ask it anything, and
businesses can connect it to their own websites, apps, POS and customer service.

**Status:** Phase 1 (security foundation) in progress on the `development` branch.

## Run it

Needs Node.js 22 or newer. There is nothing to install.

```
npm start        # serves on http://localhost:10000
npm test         # runs every test
```

## Layout

| Path | What it is |
| --- | --- |
| `server.js` | Starts the HTTP server |
| `src/` | The service: HTTP handling, gateway, routes |
| `public/` | The chat page |
| `test/` | Tests (`node:test`, no extra packages) |
| `docs/decisions/` | Architecture decision records |
| `reference/crazybite-chat/` | The original Nasrin code, unchanged, for reference only |

## Decisions

- [ADR-001: Access model and hosting](docs/decisions/001-access-and-hosting.md)
- [ADR-002: No third-party runtime packages](docs/decisions/002-no-runtime-dependencies.md)
