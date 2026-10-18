# Universal user-owned integration security

Status: required platform contract for all current and future integrations.

## Non-negotiable product rule

Every integration that a user can see or invoke must act only on resources reachable through that user's own explicitly connected provider account, or through a resource explicitly shared with the user by an authorized team. This applies to existing integrations, the Developer tools hub, native apps, plugins, automation actions, agent tools, scheduled jobs, and future providers. A provider being enabled globally does not grant users access to the platform owner's account.

## Identity and ownership

- Require a valid signed-in NasrinAI user for connecting accounts or accessing private provider resources. Guest/public routes must not expose private integrations.
- Resolve the acting user from the verified server-side caller/session; never trust a client-supplied user ID, tenant ID, provider account ID, project ID, or owner field as proof of access.
- Store each connection with immutable owner and tenant identifiers, provider identifier, provider-side account identifier, status, scopes/permissions, timestamps, and encrypted credential material.
- Every read, write, reconnect, refresh, disconnect, background job, and tool invocation must re-check ownership and current permissions on the server. A guessed or copied resource ID must not bypass authorization.
- Multiple connected accounts are supported where the provider allows it. Selecting an active account must not overwrite or silently switch another account's credentials.
- Cross-user access is denied by default. Team sharing is a separate explicit grant with role, scope, revocation, and audit trail; shared platform tenancy is not a grant.

## Credential handling

- Use provider OAuth / app installation flows with signed, expiring, single-use state bound to the authenticated user whenever supported.
- Where a provider requires a user-created token, collect it only in a secure connection flow and encrypt it at rest with authenticated encryption using a server-only key. Never store credentials in localStorage, client-visible config, URLs, logs, chat messages, AI memory, analytics, or error output.
- Never use an owner's deployment environment token as a shared end-user connection. Environment credentials may be used only for clearly defined platform-owned operations and must be isolated from user-owned connections.
- Return safe metadata only; never return access tokens, refresh tokens, secret keys, or encrypted credential blobs to the client.
- Request least privilege, handle expiration/revocation, rotate credentials where supported, and delete stored credentials on disconnect. Revoke provider grants where supported.

## Read/write policy

- Read-only is the default for a new integration and for every new action.
- Writes must use the exact account selected by the user and be authorized against the provider's current scopes and resource permissions.
- Consequential actions (deployments, DNS/domain changes, permission changes, database/schema changes, destructive actions, publishing, sending messages, or spending money) require an explicit user confirmation with a clear action summary. Confirmation must be bound to the authenticated user, resource, and proposed action; do not accept a generic or stale confirmation.
- Apply input validation, request timeouts, bounded pagination/log sizes, rate limits, idempotency where possible, safe error messages, and secret redaction.
- Do not run arbitrary SQL or destructive commands just because a connected account has broad credentials. Expose narrow, auditable capabilities.

## Data, memory, and auditing

- Scope connection records, linked resources, project maps, automation runs, approval records, and activity history to the authenticated user or explicitly authorized team.
- Persist only useful, minimal metadata. Do not put raw provider responses, secrets, or sensitive logs into conversational memory.
- Record security-relevant events (connect, reconnect, permission change, action approval, write result, disconnect, denied cross-account access) without recording credentials or sensitive payloads.
- Let users inspect connected accounts, review granted permissions, choose an active account, unlink resources, disconnect, and delete their integration metadata.

## Required provider and regression tests

For every provider and each new integration action, add tests for:
1. User A cannot list, read, write, refresh, or disconnect User B's connection, even with a copied connection/resource ID.
2. A user cannot access another account by spoofing user, tenant, project, workspace, team, or provider account IDs in request bodies, paths, or query strings.
3. Authorized access to the user's own connection works; multiple accounts remain isolated.
4. Missing, malformed, expired, revoked, and insufficient-scope credentials fail safely.
5. OAuth state is signed, short-lived, single-use, and bound to the initiating user.
6. Write actions are rejected without a matching, fresh confirmation; denied or failed actions do not report success.
7. Secrets never appear in API responses, browser payloads, logs, chat, memory, or test failure output.
8. Provider 4xx/5xx, timeouts, rate limits, and malformed responses are handled without leaking secrets or corrupting connection state.
9. Disconnect/revocation and user deletion clean up credentials and associated metadata safely.
10. Database constraints and RLS reinforce, rather than replace, server-side ownership checks.

## Rollout gates

- Inventory all existing provider integrations and classify each route/tool/action as public, user-owned, or explicitly shared.
- Do not claim an integration is connected until the server verifies the connection and performs a safe provider identity/read check.
- Keep unimplemented providers visibly Not configured. Never make a dashboard link look like a working API integration.
- Add migrations and RLS policies before deploying code that depends on new tables/columns. Include rollback guidance.
- Run unit, integration, isolation, migration/RLS, and full repository tests; inspect CI and resolve failures before merge.
- Enable write capabilities only after the provider's read path and isolation tests pass.
- This document is a required contract, not proof that all existing integrations have already been audited or that unimplemented providers are live.
