# ADR-001: Access model and hosting

- **Status:** Accepted on 2026-10-05. The API host (Render) was replaced by Vercel in [ADR-003](003-host-on-vercel.md); the rest stands, with the owner's decisions below. The model-machine setup is confirmed in Phase 3.
- **Date:** 2026-10-05
- **Phase:** 1 (security foundation), step 1
- **Source:** NasrinAI Phase 0 audit, findings H2, M1, M2, M6

## Decision

Every request to NasrinAI passes through one gateway that turns a credential into
`(tenant, actor, scopes)` before anything else runs. No model call happens without
an identified caller: a signed-in user, a business key, or a server-issued guest session. Conversation history, rate limits and usage records live on
the server, never in the browser. The model runtime is never reachable from the
internet; only the NasrinAI server can call it.

## Context

The Nasrin code NasrinAI starts from (`reference/crazybite-chat/`) was built for one
restaurant. The Phase 0 audit found four problems in it that NasrinAI must not repeat:

| Finding | Problem in the reference code |
| --- | --- |
| H2 | `/api/chat` and `/api/tts` accept anyone, with no spend ceiling |
| M1 | The browser sends the chat history, including "assistant" turns |
| M2 | Rate limits are counted in each server instance's memory |
| M6 | No record of model calls, tokens or cost |

NasrinAI will have four kinds of callers, which need different credentials:

1. People using the standalone NasrinAI chat while signed in.
1. Guests using the standalone chat without signing in.
2. A chat widget embedded in a business's website or app.
3. A business's own systems (POS, CRM, back office) calling server to server.

A local model needs a machine that stays running, with enough memory or a GPU.
Serverless functions (such as Vercel's) cannot host one.

## Options considered

### Access

| Option | Summary | Verdict |
| --- | --- | --- |
| A. Open endpoint plus per-IP limits | What the reference code does | Rejected: H2 and M2 |
| B. One shared API key for everything | Simple | Rejected: a key in a web page is public, and it cannot tell businesses or users apart |
| C. A credential per caller type, resolved at a gateway | Described below | **Chosen** |

### Hosting

| Option | Summary | Fit |
| --- | --- | --- |
| Host A. API on Vercel functions, model on a separate machine | Close to today's setup | Weak: function time limits hurt streaming, and in-memory state resets |
| Host B. API on one long-running Node server, model on a separate private machine | API and model scale and fail separately | **Chosen** |
| Host C. API and model on the same GPU server | Fewest moving parts | Possible later; one machine failing takes everything down |

## Chosen option

### Credentials (option C)

| Caller | Credential | What it may do | Where it may live |
| --- | --- | --- | --- |
| Standalone chat user | Supabase Auth session, re-verified by the server on every request | Chat as themselves | Their browser |
| Guest (no sign-in) | Short-lived guest session issued by the NasrinAI server, tied to a random guest id | General questions only: no tools, no business data, no saved memory | Their browser |
| Embedded widget | Publishable business key: public, limited to listed website origins, chat-only scope | Chat for that business; never tools or data | The business's web page |
| Widget end user (optional) | Short-lived token signed by the business's own server | Ties a chat to that business's customer | Passed by the business's server |
| Business system | Secret business API key, stored only as a hash, scoped, revocable, rotatable | Only the tools and data granted to that key | The business's servers, never a browser |

Rules that hold for every caller:

- `tenant_id` and the actor come **only** from the credential, never from the request body.
- No credential, an unknown key, or a failed check means the request stops there (fail closed).
- The browser sends only the new message and a conversation id. History is loaded on the server from the conversation's owner (fixes M1).
- Rate limits and quotas are counted in shared storage, per key, per user and per tenant, plus a daily token and spend ceiling per tenant (fixes H2, M2).
- One usage record per model call: tenant, actor, provider, model, tokens in and out, latency, outcome, estimated cost. No message text by default (fixes M6).

Extra guardrails for guests, because guest access is the easiest path to abuse:

- Small per-guest and per-IP quotas, counted in shared storage.
- A global daily ceiling for all guest usage together. When it is reached, guests are asked to sign in; signed-in users and businesses are unaffected.
- Guests use the cheapest available model (the local model once it exists).
- Guest conversations are kept on the server only for the session and deleted after it expires.
- A bot check before issuing guest sessions is ready to switch on if abuse appears; it is off at first to keep the chat easy to use.

### Hosting (Host B, chosen)

- **API and gateway:** Node.js with Express, the stack the reference code already uses, as a **Render web service**. Chosen for ease of use: it deploys from GitHub on push, keeps environment variables in a web dashboard that works from a phone, runs a long-lived Node process, and is a host the owner already uses.
- **Database and auth:** a **new, separate** Supabase project for NasrinAI, created by the owner, so no NasrinAI key can ever reach Crazy Bite's data.
- **Shared counters:** Postgres in that Supabase project at first. Add Redis only if measured load needs it.
- **Model runtime (Phase 3), combined setup:** a small model that is always available, plus a larger local model on the owner's computer or a rented GPU when one is online. The AI router picks between them. Every model machine is on a private connection and accepts calls only from the API server with a secret; none is exposed to clients.

## Reason

Each caller type gets the weakest credential that still works for it, and none can
reach more than its scope. Resolving the tenant at the gateway, before any model or
tool code runs, is what later makes multi-business isolation possible. Reusing
Node, Express and Supabase avoids new technology the project does not need yet.

## Security implications

- Closes H2, M1, M2 and M6 by design, before any NasrinAI code is written.
- A leaked publishable key can only chat for one business, within its quota and listed origins.
- A leaked secret key is limited to its scopes and can be revoked without affecting other keys.
- The model host has no public address, so it cannot be called or probed directly.
- Remaining risk: a stolen user session can still chat as that user until it expires or is revoked.
- Remaining risk: guest access lets anyone spend some model capacity. The guest quotas and the global guest ceiling cap that cost; the bot check is the next lever.

## Performance implications

- One extra lookup per request (credential to tenant). This is small, and the key lookup can be cached briefly.
- Server-side history adds one database read per message, and the browser sends less data.
- A long-running API host allows streaming replies, which serverless functions limit.

## Cost implications

- One always-on API server and one new Supabase project. Their size and price depend on the plans chosen and are not decided here.
- The model machine is the largest cost and is decided in Phase 3.
- Per-tenant spend ceilings and the global guest ceiling put an upper bound on model cost.

## Rollback strategy

This record changes no code. Until code is built on it, rolling back means reverting
this file. After that, each piece (gateway, history store, counters, usage log)
lands as its own small change and can be reverted separately.

## Owner decisions (2026-10-05)

| # | Question | Decision |
| --- | --- | --- |
| 1 | May people chat without signing in? | Yes, with the guest guardrails above |
| 2 | API host | Left to the engineer, aiming for ease of use: Render web service |
| 3 | Separate Supabase project for NasrinAI | Yes; the owner creates it |
| 4 | Model machine | Combined: an always-on small model plus a larger local or GPU model, chosen by the router; confirmed in Phase 3 |
