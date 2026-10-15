# NasrinAI Performance and Scalability Upgrade — Claude Handoff

**Created:** 2026-10-15  
**Status:** Planning and implementation checklist — no performance code changes are claimed by this document.  
**Repository:** `primusco20/nasrinAI`  
**Target branch:** `main` (owner merges only)  
**Priority:** Correctness, security, and measured improvements before speed.

## Mission

Audit and improve the real NasrinAI application across frontend delivery, rendering, API traffic, caching, database performance, and deployment infrastructure. Work from evidence in the current repository and deployment. Do not blindly implement every technique: inspect the existing architecture first, choose the safest applicable implementation, measure before and after, and record anything that is unnecessary or blocked.

## Non-negotiable repository rules

1. Read `CLAUDE.md` and `docs/claude-code-handoff.md` before implementation.
2. Use a dedicated feature branch per logical category, opened as a PR into `main`. Never push directly to `main`, merge a PR, or deploy to production without owner approval.
3. Preserve current features, AI provider routing, streaming/NDJSON contracts, authentication, tier limits, billing, and user-visible behavior unless a change is explicitly approved.
4. Never weaken Supabase RLS, policies, grants, storage privacy, CSP, or security headers. Never expose keys, tokens, private user data, or internal configuration.
5. Repository architecture requires **zero runtime dependencies (ADR-002)**. Do not add a runtime package without the owner's explicit approval. Prefer built-in capabilities and existing platform features.
6. Supabase is production. Any schema/index change must be a numbered migration, have database tests, and be tested on staging before production.
7. Do not claim a task is done until code, tests, and measurements prove it. Keep a checklist with evidence, changed files, test results, risks, and owner actions.
8. No speculative infrastructure. A CDN, load balancer, connection pool, or cache must fit the actual hosting and traffic topology; explain why it is needed before introducing it.
9. Keep caches tenant-safe and privacy-safe. Never share authenticated or user-specific results across users. Do not cache sensitive responses publicly.
10. Do not break Safari/iPhone behavior, responsive layouts, accessibility, reduced-motion preferences, or slow-network usability.

## Required first step: baseline and architecture inventory

Before editing implementation files:

- Inspect current package scripts, build/deploy configuration, frontend entry points, API routes, image generation/upload flows, database access layer, Supabase migrations, existing cache utilities, and existing CDN/Vercel configuration.
- Identify what is already implemented. Do not duplicate it.
- Run the existing test suite and secret scanner; record actual results and failures.
- Capture a repeatable Lighthouse baseline for the production-like preview (not just a local development server). Test mobile and desktop where applicable. Save report links/artifacts or document the environment and measurements.
- Record LCP, INP, CLS, FCP, TTFB, total blocking time, transfer size, image bytes, JavaScript/CSS bytes, request count, cache hit/miss behavior where observable, API latency, and relevant database query timings.
- Identify top bottlenecks and rank them by measured user impact, risk, and effort. Do not make arbitrary numeric improvement promises.

## Workstreams and acceptance criteria

Track each item as **Not started**, **In progress**, **Blocked**, **Not applicable (evidence required)**, or **Verified**. A proposal or code edit alone is not Verified.

### A. Image optimization

- Inventory images and generated/user-uploaded media paths.
- Compress and resize static assets and generated previews where safe; use modern formats (such as WebP/AVIF) only where the existing pipeline and client support justify them.
- Preserve visual quality, aspect ratio, transparency where needed, and original uploaded files. Never destructively overwrite a user's original upload.
- Provide responsive image sizes where appropriate, explicit dimensions or aspect ratios to reduce layout shift, and suitable cache headers for versioned static assets.
- Lazy-load off-screen, non-critical images; do **not** lazy-load the main above-the-fold/LCP image. Use appropriate async decoding when supported.
- Verify generated images, previews, avatars, attachments, and mobile layouts still work.

**Acceptance:** before/after bytes and visual checks documented; no broken images or layout regressions; tests cover the relevant rendering/serving behavior.

### B. Lazy loading and code splitting

- Split JavaScript by actual route, feature, or expensive optional UI using the existing build/runtime architecture.
- Defer optional panels and non-critical modules until needed; avoid loading large feature code on the initial chat path when not required.
- Preserve initialization order, error handling, streaming, authentication, and navigation.
- Avoid splitting tiny modules when request overhead or complexity would outweigh the gain.
- Do not add a bundler or dependency without owner approval and architecture review.

**Acceptance:** bundle/build output shows the intended reduction or deferral; primary flows and direct navigation work; tests cover loading and failure paths.

### C. JavaScript, CSS, and rendering

- Inspect JS/CSS size, duplication, unused rules, blocking resources, long tasks, and expensive DOM updates.
- Minify and compress production assets using existing deployment tooling; remove dead code only after references and dynamic use are checked.
- Defer non-critical scripts; do not defer scripts required for initial rendering, security checks, or correct app startup.
- Reduce unnecessary re-renders and repeated DOM work using the current rendering model. Avoid introducing a framework or state library.
- Debounce high-frequency search/filter/autocomplete inputs where appropriate; use throttling only for event types where it is more suitable. Cancel or ignore stale async results and preserve immediate submit/keyboard behavior.
- Add loading skeletons to genuinely asynchronous sections where they improve perceived loading. Match final layout dimensions, support accessibility, and respect `prefers-reduced-motion`. Always provide an error/empty state and avoid indefinite skeletons.
- Remove unused dependencies only after checking direct, transitive, build, test, script, and deployment usage. Respect the zero-runtime-dependency rule.
- Preserve the strict CSP (no inline scripts/styles) and current accessibility requirements.

**Acceptance:** no console errors, no broken interactions, no regression in keyboard/screen-reader behavior, and measured asset/render improvements.

### D. API response caching and payload compression

- Map endpoints by method, authentication, data sensitivity, tenant scope, mutability, and cacheability.
- Cache only responses proven safe to cache. Use explicit TTLs, bounded storage, invalidation rules, and clear cache keys that include every relevant tenant/user/permission/version dimension.
- Never publicly cache personalized chat history, account data, billing, secrets, private files, or authenticated responses. Use safe private/no-store headers where required.
- Do not cache errors, incomplete streaming output, authorization failures, or non-deterministic AI responses by default. Any AI semantic/result cache must be reviewed separately for privacy, freshness, provider/prompt/model versioning, and tenant isolation.
- Compress JSON/text payloads using existing platform support (Brotli/gzip) when beneficial. Avoid double compression and do not compress already-compressed media. Keep streaming/NDJSON behavior and content types intact.
- Reduce payload fields only when clients do not rely on them. Paginate large responses instead of returning unbounded arrays.
- Cache expensive deterministic computations only after profiling; use bounded caches, explicit invalidation, and protection against memory growth and stampedes.

**Acceptance:** tests prove cache isolation, expiry/invalidation, compression negotiation, pagination, and unchanged API contracts; report payload size and latency before/after.

### E. CDN, server-side caching, and delivery

- Inspect current Vercel/Cloudflare configuration and what is already served through a CDN.
- Use the existing CDN for public, versioned static assets where appropriate; establish long-lived immutable caching only for content-addressed/versioned files. Use conservative revalidation for mutable assets.
- Keep authenticated APIs, user-specific media, private uploads, and personalized content out of public shared caches unless a reviewed design explicitly guarantees isolation.
- Evaluate server-side caching only where the deployment runtime supports it. Document whether the cache is per-request, per-instance, or shared across instances; do not assume in-memory state is globally shared or durable in serverless deployments.
- Defer non-critical server work only when it does not delay required responses, violate reliability, or lose errors. Make failures observable.

**Acceptance:** inspect actual response headers and cache behavior on preview; verify cache invalidation after deploy and ensure private responses cannot be served to another user.

### F. Database indexing and query performance

- Inspect real query patterns, query plans where available, table sizes, filters, joins, sort orders, existing indexes, and slow-query evidence before adding indexes.
- Avoid duplicate, redundant, speculative, or excessively broad indexes. Consider write overhead, storage, index selectivity, and migration duration.
- Add indexes only via a numbered Supabase migration, with a documented reason and a database regression/performance test. Use an appropriate safe index creation strategy for the real database and migration system.
- Check pagination and query limits, N+1 patterns, unnecessary columns, sequential requests, and missing filters.
- Preserve RLS and tenant/owner scoping. Do not change policies to make a query faster.

**Acceptance:** migration and DB tests pass on staging; query plan/timing evidence shows a meaningful improvement; RLS and data correctness remain intact.

### G. Database connection pooling

- Inspect the actual database client, runtime lifecycle, Vercel/serverless concurrency, Supabase connection limits, and current pooler configuration first.
- Reuse a supported Supabase connection pooler or existing supported pooling approach only if the current access pattern needs it.
- Do not create an unbounded pool per serverless invocation, expose connection strings, or blindly change transaction/session modes.
- Verify prepared statements, transaction semantics, migrations, and session-dependent behavior against the selected pooling mode.
- Document required environment/configuration changes without including secret values. Staging first; owner approval before production configuration changes.

**Acceptance:** connection counts, pool saturation, errors, and latency are measured; auth/RLS/transaction behavior remains correct.

### H. Load balancing and horizontal scale

- Determine whether current Vercel/serverless infrastructure already handles request distribution and scaling. Do not add a separate load balancer merely because it appears on a generic optimization checklist.
- If a real bottleneck or availability requirement justifies additional balancing, provide an architecture proposal first: traffic path, health checks, TLS, timeouts, sticky-session requirements, streaming support, rate limiting, failover, cost, observability, and rollback.
- Keep session/auth state compatible with multi-instance execution. Do not rely on process-local memory for cross-instance sessions, limits, or shared cache correctness.
- Obtain owner approval before introducing new infrastructure or changing DNS, CDN, routing, or production deployment settings.

**Acceptance:** load/failover tests and operational evidence support the design; cost, risks, and rollback are documented. Otherwise mark Not applicable with evidence and explanation.

### I. Pagination and large lists

- Identify large history, library, generated-media, admin, and other list views and their API/data sources.
- Prefer server-side cursor/keyset pagination for large or frequently changing datasets when compatible with existing contracts; use deterministic ordering and a stable tie-breaker. Avoid unbounded queries and offset pagination at very large offsets unless justified.
- Add accessible loading/empty/error states and retain filters/sort when navigating pages.
- Prevent duplicate/missing rows across page boundaries and handle deleted or newly inserted records.
- Apply tenant/owner scope to every page request and query.

**Acceptance:** tests cover page boundaries, ordering, duplicates, filters, empty results, failures, and authorization isolation.

### J. Lighthouse audit and ongoing verification

- Run Lighthouse against a production-like preview with documented URL, device profile, date, and environment. Run more than once where noise is material; compare equivalent conditions.
- Review Performance, Accessibility, Best Practices, and SEO findings. Fix high-impact, evidence-backed issues without weakening security or changing product behavior.
- Include screenshots/report artifacts or links when available, and a concise before/after table.
- Treat Lighthouse as a diagnostic, not a substitute for real-user metrics, API/database timings, functional tests, or accessibility review.
- If CI integration is proposed, inspect existing CI first and keep it deterministic and proportionate.

**Acceptance:** reports and reproducible comparison are attached; every claimed fix is tied to evidence; remaining findings are listed with rationale.

## Suggested implementation order

1. Baseline, architecture inventory, and quick wins with low risk.
2. Static image optimization, correct lazy loading, asset compression, and non-critical script deferral.
3. JS/CSS cleanup, focused code splitting, rendering/input improvements, and loading states.
4. Pagination and payload reductions.
5. API/server-side caching and expensive-computation caching with privacy tests.
6. Database query review and indexes, each through staging-tested migrations.
7. Connection pooling review based on measured topology.
8. CDN/cache header verification and load-balancing decision based on actual hosting architecture.
9. Repeat Lighthouse and targeted load/API/database tests; document results.

Split into separate focused PRs when a workstream has distinct risks or testing requirements. Do not force every item into one enormous PR.

## Progress tracker

| Workstream | Status | Evidence / changed files | Risks / follow-up |
|---|---|---|---|
| Baseline and architecture inventory | Not started | — | Record existing implementation before edits |
| Image compression and responsive sizing | Not started | — | Preserve original uploads and visual quality |
| Lazy loading | Not started | — | Protect LCP/above-the-fold image |
| Code splitting and chunks | Not started | — | Preserve startup order and existing tooling |
| JavaScript/CSS optimization | Not started | — | Preserve CSP and accessibility |
| Reduce unnecessary re-renders | Not started | — | Follow current rendering architecture |
| Debounce input handlers | Not started | — | Avoid stale results and delayed submit |
| Remove unused dependencies | Not started | — | Zero runtime dependencies; audit usage |
| Defer non-critical scripts | Not started | — | Never defer required initialization |
| Loading skeletons | Not started | — | Include error/empty states and reduced motion |
| API response caching | Not started | — | Tenant isolation and invalidation |
| Compress API payloads | Not started | — | Preserve streaming and content negotiation |
| Paginate large lists | Not started | — | Stable ordering and authorization |
| Cache expensive computations | Not started | — | Bound memory; define freshness/invalidation |
| Server-side caching | Not started | — | Verify runtime and shared-cache semantics |
| CDN/static asset delivery | Not started | — | No public caching of private data |
| Database index review | Not started | — | Numbered migration + DB test + staging |
| Database connection pooling | Not started | — | Verify real topology and pooler semantics |
| Load balancer evaluation | Not started | — | May be unnecessary with existing platform |
| Lighthouse baseline and final audit | Not started | — | Keep comparable reports and actual metrics |
| Final regression/security validation | Not started | — | All required checks green before handoff |

## Required Claude completion report

For each PR, report:

1. PR URL, branch, and concise scope.
2. Root-cause evidence and baseline metrics.
3. Files changed and why.
4. Checklist items marked Verified, Blocked, or Not applicable, with evidence.
5. Exact test commands and observed pass/fail results; do not infer unrun checks.
6. Lighthouse before/after results and environment details.
7. Database migrations, environment/configuration changes, and owner-only steps (names only; never values of secrets).
8. Security/privacy review, performance trade-offs, known limitations, and rollback plan.
9. Confirmation that production was not changed and the PR was not merged by Claude.

**Definition of done:** changes are architecture-compatible, tested, measured, documented, secure, reversible, and ready for owner review. A list of optimizations without verified outcomes is not completion.
