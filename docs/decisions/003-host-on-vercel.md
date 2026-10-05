# ADR-003: Host the API on Vercel

- **Status:** Accepted
- **Date:** 2026-10-05
- **Supersedes:** the "API host" part of ADR-001 (Render web service)

## Decision

NasrinAI's API and chat page run on Vercel, in the Singapore region (`sin1`).
Vercel runs `server.js` as a function; the files in `public/` are served by
Vercel's CDN with the security headers in `vercel.json`. Everything else in
ADR-001 stands: the access model, the separate Supabase project, and the model
machine for Phase 3.

## Context

ADR-001 chose Render mainly because serverless functions lose in-memory state
and limit long requests. By the end of Phase 2 that no longer applies:

- Rate limits, budgets, conversations and usage live in the database, so a
  fresh function instance loses nothing that matters. Only short caches reset.
- A chat turn waits at most 30 seconds for the model; Vercel allows 300.
- Vercel can run a plain Node `server.js` that calls `server.listen()`.
- Vercel overwrites `X-Forwarded-For` with the client's address, so the
  existing client-IP rule (`TRUST_PROXY_HOPS=1`) reads the right IP.

The owner already runs a project on Vercel and asked to use it.

## Options considered

| Option | Verdict |
| --- | --- |
| Render web service (ADR-001) | Works; paid by default; one deploy branch |
| Vercel | **Chosen**: known to the owner, free for testing, a preview link per branch |

## Security implications

- Page headers now come from two places: the server (API responses) and
  `vercel.json` (page files). A test fails if the two page CSPs ever differ.
- Only `public/` is served as files; the rest of the repository is not.
- Vercel functions have no fixed IP or private network on the Hobby or Pro
  plans. The Phase 3 model machine is reached through a tunnel with a shared
  secret, the same as it would have been from Render.
- Hobby keeps runtime logs for 1 hour. Usage records are in the database and
  are not affected.

## Cost implications

- Testing: Hobby plan, free.
- Vercel's Hobby plan is for personal, non-commercial use only. Before
  businesses pay for NasrinAI, the project moves to Pro.

## Rollback strategy

`render.yaml` and the Render guide are in Git history (commit `2db5420`).
Restoring them and deploying on Render needs no code change; the server runs
the same on both.
