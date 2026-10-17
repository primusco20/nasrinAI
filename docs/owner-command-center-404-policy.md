# Owner Command Center — Hidden Route and 404 Policy

Status: mandatory security requirement for the Owner Command Center specification and implementation. This is documentation only; it does not change runtime behavior or production configuration.

## Required behavior

The Owner Command Center route (proposed: `/owner`) must return a genuine HTTP `404 Not Found` response to any visitor who is not authorized as the owner. Do not render the dashboard shell, owner navigation, a login screen specific to the dashboard, or an explanatory `403 Access Denied` page to unauthorized visitors. Use the same neutral 404 behavior whether the visitor is signed out, has an unapproved email, has an unapproved IP, or the allowlist configuration is missing or invalid. Avoid response differences that reveal which check failed.

The route may return the dashboard only when all required conditions pass on the server: a valid authenticated session, an exact match for the verified identity in `OWNER_ALLOWED_EMAILS`, and a match for the request's trusted client IP in `OWNER_ALLOWED_IPS`. Both allowlists must be configured and valid. If trusted client IP cannot be determined safely, return 404. Do not trust arbitrary client-supplied forwarding headers.

## Enforce it everywhere

- Return HTTP 404 from the owner page route for every unauthorized request, including direct URL visits and alternate path forms.
- Every Owner Command Center API, data endpoint, export endpoint, and control endpoint must independently enforce owner authorization. Unauthorized API requests must also return a generic 404 without data.
- Do not rely on hiding the navigation button, client-side redirects, an unlinked URL, robots.txt, or frontend code as protection.
- Ensure server-rendered HTML, static assets specific to the owner view, API responses, caches, and error messages do not leak owner data before authorization. Use private/no-store caching for owner responses where appropriate.
- Authorized owners who pass every check may use the dashboard normally. Do not redirect an unauthorized visitor to a public login page that reveals the owner route exists.
- Keep authorization denial behavior consistent and avoid exposing which allowlist condition failed. Record only safe, minimized audit metadata where available.

## Required tests

1. Signed-out visitor to `/owner` receives HTTP 404 and no owner content.
2. Signed-in user with an unapproved email receives HTTP 404.
3. Approved email from an unapproved IP receives HTTP 404.
4. Approved IP with an unapproved email receives HTTP 404.
5. Missing, blank, or malformed allowlist configuration receives HTTP 404 and fails closed.
6. Forged `X-Forwarded-For`, `X-Real-IP`, or browser-supplied identity values cannot grant access.
7. Every owner API/export/control endpoint independently returns a generic 404 to unauthorized callers and returns no protected data.
8. Encoded, trailing-slash, case-variant, or alternate route forms cannot bypass authorization.
9. Authorized owner access works only when the trusted session, email allowlist, and trusted IP allowlist all match.
10. Automated tests verify the actual HTTP status and response body; screenshots alone do not count.

## Scope and deployment boundary

This policy supplements `docs/owner-command-center.md`, especially its authentication/authorization and owner allowlist sections. Where prior wording suggests returning `403` for authenticated non-owners or another unauthenticated response, this document supersedes it for the Owner Command Center: **unauthorized visitors receive the same generic HTTP 404**.

No runtime code, DNS, route, environment variable, hosting configuration, or production deployment is changed by this document. Implementation must happen in a reviewed code change, with tests, and must not be merged or deployed without the owner's explicit approval.
