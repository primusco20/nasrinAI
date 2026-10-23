# Owner Console — Vercel Environment Allowlist

Status: configuration guide for the Owner Command Center on `feature/owner-console-v2`. The runtime guard is implemented in the feature branch; this document does not change Vercel settings or production configuration.

## Configure in Vercel

Open **NasrinAI → Settings → Environment Variables** in the Vercel project:

https://vercel.com/nasrin-ai/nasrinai/settings/environment-variables

Add these server-side variables:

| Variable | Value format | Purpose |
| --- | --- | --- |
| `OWNER_ALLOWED_EMAILS` | Comma-separated exact email addresses | Verified Supabase user emails allowed to enter the Owner Console |
| `OWNER_ALLOWED_IPS` | Comma-separated exact public IPv4 or IPv6 addresses | Public client IPv4 or IPv6 addresses allowed to enter the Owner Console |

Example format only (do not copy the documentation IP as your real address):

```text
OWNER_ALLOWED_EMAILS=owner@example.com
OWNER_ALLOWED_IPS=203.0.113.24,198.51.100.17
```

The addresses in the example are reserved for documentation and will not work as real public client addresses. Enter the actual public IPv4 or IPv6 address(es) you want to allow. IPv6 entries are normalized before exact comparison. Do not put these values in `NEXT_PUBLIC_*` or any browser-exposed variable.

Choose the Vercel environment(s) intentionally. Use a separate, tightly restricted list for Preview if previews are enabled; never allow all IPs or a broad network range just to make preview access easier. After changing a variable, redeploy the relevant environment so the runtime receives the updated value.

## Required runtime behavior

- Parse and validate both variables on the server for every protected request. Blank, missing, malformed, or empty allowlists deny access.
- Normalize email addresses to lowercase and compare exact entries against the email returned by the existing server-side Supabase Auth verifier. Never trust an email sent by browser code.
- Compare the trusted client IP obtained through the existing `clientIpFrom(req, config.trustProxyHops)` resolver against exact allowlisted IPv4 or IPv6 entries. Do not read raw `X-Forwarded-For` or `X-Real-IP` directly.
- Unknown client IP, invalid IP, missing trusted proxy configuration, or an allowlist mismatch must fail closed.
- A visitor who is not authorized must receive a genuine HTTP `404 Not Found` with the same generic response whether they are signed out, have the wrong email/IP, or the configuration is invalid. Never return allowlist diagnostics to the browser.
- Enforce the policy on the owner page, session bootstrap, every owner API, export, and control route. A hidden navigation link or frontend-only check is not security.
- Owner responses must use private/no-store caching. Do not log tokens, cookies, or full allowlist values.
- Do not use Vercel Trusted IPs as a substitute for this application allowlist. Vercel deployment protection affects access to deployments and can unintentionally block the public site; this requirement is for the Owner Console only.

## Operational note

Public IP addresses can change when switching Wi-Fi, mobile data, VPNs, or internet providers. When that happens, update `OWNER_ALLOWED_IPS` in Vercel and redeploy. Keep at least one verified recovery address available before removing an existing entry to avoid locking yourself out.

## Acceptance tests

1. Approved verified email + approved trusted IP + valid owner session: access allowed.
2. Unlisted IP, unapproved email, signed-out request, missing/invalid allowlist, or invalid/expired session: same generic HTTP 404.
3. Forged forwarding headers cannot change the IP used for authorization.
4. Changes to the environment allowlist take effect after deployment and are rechecked on protected requests.
5. Owner APIs, exports, and controls enforce the same policy independently.
6. No owner data, session details, secrets, or allowlist values are returned or cached for unauthorized requests.

This document defines the required configuration and behavior. Runtime implementation, automated test results, Vercel environment updates, and deployment must be tracked separately and must not be claimed until verified.
