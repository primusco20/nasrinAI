# NasrinAI Developer Integrations Hub

## Product behavior

The Developer tools section is a provider hub for GitHub, Vercel, Render, Supabase, and Cloudflare. Each provider row exposes a compact Actions dropdown with Settings and Connect / Disconnect. The interface must never imply a provider is connected merely because its dashboard link exists.

### Provider settings

- GitHub: preserve the existing GitHub OAuth and coding workflow. Its connection state and disconnect action remain owned by the existing GitHub integration.
- Vercel: connected accounts, add account, projects, deployments, build status, permissions, integration information.
- Render: connected accounts, add account, projects, services, deployments, build status, permissions, integration information.
- Supabase: connected accounts, add account, projects, database health, migration status, permissions, integration information.
- Cloudflare: connected accounts, add account, domains, add domain, DNS, security status, permissions, integration information.

## Required implementation architecture

The first UI slice adds provider action menus and a settings overview. Vercel, Render, Supabase, and Cloudflare must remain explicitly not connected until server-side OAuth/API adapters are implemented. Do not fake a successful connection or store API tokens in localStorage, the browser, client-visible configuration, or chat history.

### Connection and credential layer

Create a provider registry with separate adapters for Vercel, Render, Supabase, and Cloudflare. Each adapter should expose capability metadata, connection initiation/callback, status, account listing, disconnect, and only the provider-specific read operations needed by the UI. Use least-privilege scopes and encrypted server-side token storage. Multi-account support must key credentials by tenant/user/provider/account ID and permit choosing the active account without replacing another account's credentials. OAuth state must be signed, one-time, expiring, and bound to the signed-in user.

Secrets belong in server environment variables or a managed secret store. Never return secrets, access tokens, refresh tokens, service-role keys, or raw environment values to the client. Disconnect must revoke credentials where supported and delete stored tokens. Handle missing credentials and provider errors as a clear Not configured or Needs attention state.

### Provider read surfaces

- Vercel: accounts/teams, projects, deployments, deployment state, build logs where authorized, project access permissions.
- Render: workspaces, services, deploy history, deploy state, build/runtime logs where authorized, service permissions.
- Supabase: organizations/projects, project health, database reachability/health metadata, migration status, access roles/permissions. Do not expose table rows or SQL execution by default.
- Cloudflare: accounts, zones/domains, DNS records, security posture summaries, zone-level permissions. Adding a domain is a consequential action and requires an explicit confirmation screen.
- GitHub: use the existing integration for repositories, branches, pull requests, commits, and CI status. Avoid a second competing GitHub OAuth implementation.

### Cross-tool intelligence and continuity

Persist a user-approved developer workspace map: provider account IDs, linked projects, GitHub repository, deployment target, Supabase project, Cloudflare zone/domain, last observed statuses, and timestamps. Let users explicitly link and unlink resources across providers; never infer ownership solely from matching names. Store a compact, auditable project timeline of integration events and user-approved decisions so NasrinAI can continue work across chats. Scope every record to the authenticated tenant/user and enforce server-side authorization and RLS.

NasrinAI should use the workspace map and event timeline as retrieval context for relevant development requests. It should distinguish verified live state from remembered historical context, show when status was last checked, and ask before performing writes. Do not store raw secrets, full sensitive logs, or arbitrary provider responses as memory. Provide user controls to inspect, unlink, and delete remembered workspace links and activity.

### Safety, reliability, and tests

- Read-only by default; mutations such as deploy, add domain, permission changes, and database migrations require explicit confirmation and idempotency where possible.
- Enforce authorization on every server route; do not rely on hidden UI controls.
- Rate-limit provider requests, paginate safely, bound log sizes, redact secrets, and handle provider timeouts.
- Add tests for OAuth state, multi-account isolation, tenant isolation/RLS, disconnect/revocation, expired tokens, missing credentials, provider 4xx/5xx/timeouts, permissions, stale status, and confirmation-gated writes.
- Keep the UI's connection state sourced from server status endpoints. Never mark a connection successful based on opening a provider dashboard.
- Run the complete test suite and inspect CI before merging; verify deployment after merge rather than assuming it succeeded.

## Current status

The initial UI slice adds a dropdown for Settings and Connect / Disconnect. GitHub delegates to its existing connection controls. Other providers intentionally show a not-configured state until their server-side adapters and secure credential storage are implemented. This is a safe scaffold, not a claim that all five provider APIs are already connected.

## Platform-wide ownership requirement

This contract applies to every current and future NasrinAI integration, not just the five Developer tools providers. See [Universal Integration Security](./universal-integration-security.md). Existing integrations must be audited against it; new providers and actions must not ship until user ownership, authorization, credential handling, and cross-account isolation tests pass. A platform environment key must never be reused as a shared end-user credential. Provider connections remain explicitly unavailable until their server-side adapters and secure credential persistence are implemented and verified.
