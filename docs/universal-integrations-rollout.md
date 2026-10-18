# Universal integrations implementation and rollout

## What this change implements

- Shared server-side identity and ownership checks using the verified gateway caller (tenantId + actor.id).
- AES-256-GCM authenticated encryption helper for provider credentials, with associated data support so ciphertext can be bound to a specific user/provider/account.
- Owner-scoped persistence primitives that query by verified tenant and user, plus safe account metadata projections.
- Authenticated read-only API routes: GET /v1/integrations and GET /v1/integrations/:id. These return status metadata only, never credential ciphertext.
- Server-only Supabase tables for encrypted integration credentials and one-time OAuth-state records (migration 042), plus database regression checks.
- Test coverage for ownership, secret encryption/tampering, owner-scoped queries, and credential redaction.

## Required deployment setup

1. Generate a new independent 32-byte encryption key and encode it as base64. For example, on a trusted local machine run: openssl rand -base64 32.
2. Add the result to Vercel as the sensitive, server-only environment variable NASRINAI_INTEGRATION_ENCRYPTION_KEY for Preview and Production as appropriate. Do not use a provider token as this key, do not expose it with a NEXT_PUBLIC_ prefix, and do not paste it into chat or source control.
3. In Supabase SQL Editor, run db/migrations/042_user_owned_integrations.sql after the existing migrations. The migration is designed to be repeatable; the database CI job also runs each migration twice.
4. Deploy only after the PR's complete CI, including the database job, passes.

## What remains before provider connections can be enabled

This is not yet a complete OAuth/API integration for every provider. The account list/status API and credential primitives are not a substitute for provider adapters. Before enabling Connect, implement and test each provider's authorization initiation/callback, signed and one-time state, provider identity verification, token exchange/refresh/revocation, encrypted credential save/load, and least-privilege scopes. Wire disconnect to provider revocation where supported. Add provider API read actions first; add writes only with explicit action-bound confirmation and provider-specific authorization. Until those steps pass, Vercel, Render, Supabase, Cloudflare and other unimplemented providers must remain Not connected / Not configured.

## Cross-account rule

Never use a client-supplied user ID or account ID as authorization. The verified gateway caller is authoritative. Every database operation must scope by both tenant_id and user_id; account IDs are identifiers, not authorization. Team sharing must be represented by explicit, revocable grants and is not implied by membership in the platform tenant.
