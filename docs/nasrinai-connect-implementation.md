# NasrinAI Connect — Implementation v1

This branch implements the first safe backend foundation described by [docs/nasrinai-connect.md](./nasrinai-connect.md).

## Current customer journey

1. Business signs in to NasrinAI.
2. Business enters its website origin.
3. NasrinAI analyzes the public site.
4. Connect creates an installation record in `verification_required`.
5. NasrinAI gives the business a short-lived verification challenge.
6. The site can prove control using a temporary `nasrinai-connect` meta tag or `/.well-known/nasrinai-connect.txt` challenge.
7. Successful verification moves the installation to `authorized`.
8. Later installers can use the authorized installation record to provision SmartChat.

## Important boundary

The verification method in v1 is a compatibility mechanism, not the final no-code installation experience.

The intended final experience remains:

**Website URL → Analyze → Authorize → Activate**

The business should not need to understand API keys, SDKs, npm, GitHub, databases, or backend configuration.

For platforms where NasrinAI can obtain explicit authorized access through an approved provider flow, Connect should use that provider adapter instead of asking the customer to edit site code.

## Security model

- URL is discovery, never permission.
- Only HTTPS public origins are accepted.
- DNS results are checked before connection.
- Private, loopback, link-local, multicast, and IPv4-mapped private destinations are blocked.
- The resolved public address is pinned for the request.
- Redirects are not followed.
- Requests have a short timeout and response-size limit.
- Connect endpoints reject guest/widget callers.
- Verification challenges expire after 30 minutes.
- Only a SHA-256 challenge hash is persisted.
- A successful verification clears the stored challenge.
- Installation records are tenant-scoped.
- Secrets are never passed to the AI model as conversation content.

## Lifecycle

`discovered` → `verification_required` → `authorized` → `ready` → `installing` → `active`

Failure and lifecycle states:

`failed`, `paused`, `removed`

v1 currently stops at `authorized`. It does not pretend that authorization equals installation.

## API

- `GET /v1/connect/sites`
- `POST /v1/connect/sites/analyze`
- `GET /v1/connect/sites/:id`
- `POST /v1/connect/sites/:id/verify`
- `POST /v1/connect/sites/:id/snippet` (manual install: the one script line for the business to paste; needs an approved configuration)
- `POST /v1/connect/sites/:id/activate` (looks for that script on the live home page, then marks the site active)
- `POST /v1/connect/sites/:id/link` (hosted chat link; needs an approved configuration)
- `GET /v1/connect/hosted/:code` and `POST /v1/connect/hosted/:code/session` (public; name/welcome and a chat-only guest session behind a hosted link)
- `DELETE /v1/connect/sites/:id`

All require an authenticated business/user or service caller.

## Next implementation layer

Build the **Installation Orchestrator** behind the same installation record:

1. Determine which authorized installation methods are available.
2. Prefer supported platform/provider authorization.
3. Use hosting/repository access only when explicitly authorized.
4. Use a managed installation path when NasrinAI can safely provision it.
5. Never silently modify a website.
6. Verify the deployed SmartChat endpoint.
7. Only then move to `active`.
8. Keep pause, reconnect, rollback, and removal idempotent.

No provider should be able to bypass the central authorization and tenant checks.


## Staging deployment contract — 2026-10-08

Before testing against a real website, deploy the branch to a non-production Vercel environment and connect it to a staging Supabase project. The test website is nasrinai.site; the production domain is nasrinai.com.

### Gate A — real website control-plane test

The following must work end-to-end:

1. Signed-in business opens Connect.
2. POST /v1/connect/sites/analyze accepts https://nasrinai.site and creates a tenant-scoped verification_required record.
3. The returned short-lived challenge is published on the staging website.
4. POST /v1/connect/sites/:id/verify changes the record to authorized and clears the stored challenge.
5. SmartChat configuration saves with server-side validation and moves the site to ready.
6. Preview is read-only.
7. Explicit approval stores an approval timestamp, actor, and configuration hash.
8. No installation is attempted by any of these steps.

### Gate B — installation test

Gate B is blocked until a real provider adapter exists. The empty provider registry is intentional. A staging adapter must be a real authorized installation path, not a mock that reports success. It must implement install, verify, rollback, and safe credential handling before the dashboard exposes activation.

### Environment separation

- nasrinai.com remains production and must not point at this staging deployment.
- nasrinai.site is staging/test only.
- Vercel staging/preview variables must point to the staging Supabase project.
- Staging and production secrets must be distinct.
- Never commit staging secrets to Git.

### Repository readiness check

The Connect config reader must retrieve metadata from the authoritative tenant-scoped row because installation bookkeeping depends on it. The staging branch must contain this fix before deployment.
