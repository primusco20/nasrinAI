# Owner Command Center — Implementation Specification

Status: proposed; documentation only until implementation PRs are reviewed and merged.
Owner: [REQUIRES INPUT: canonical owner account/identity]
Production: https://www.nasrinai.com
Architecture constraints: see `CLAUDE.md`, `docs/operations.md`, ADR-002, and the existing server-side Supabase/auth patterns.

## 1. Goal

Build an owner-only operations dashboard inside NasrinAI that gives the owner trustworthy visibility into adoption, AI operations, infrastructure, security, automation, and platform economics. It must work well on mobile Safari and remain useful when some integrations are unavailable.

This is an operational control plane, not a public analytics page. Monitoring is read-only by default. Privileged controls must use separate server-authorized endpoints, explicit confirmation, narrow permissions, and immutable/auditable event records.

## 2. Navigation

Create a responsive Owner Command Center with these sections:

1. **Overview** — core health and business KPIs.
2. **AI Operations** — requests, tiers, providers/models, tokens, latency, failures, fallback and estimated cost.
3. **Users & Growth** — accounts, active users, retention, plan mix, feature adoption and onboarding friction.
4. **Infrastructure & Releases** — health checks, API latency, deployment/build status when available, database/storage status when available.
5. **Security & Audit** — auth failures, rate-limit events, security alerts, privileged-action audit log.
6. **Automation & Jobs** — queued/running/succeeded/failed jobs, retries, schedules, stuck executions and per-step traces where supported.
7. **Finance & Costs** — provider cost, payment/subscription reconciliation, cost per active user/request, budgets and forecasts.
8. **Incidents & Alerts** — alert rules, severity, acknowledge/assign/resolve, incident timeline and recommended investigations.
9. **Reports & Exports** — date-scoped CSV exports and scheduled summaries where delivery support exists.
10. **Settings** — dashboard refresh interval, alert thresholds, notification preferences and feature flags available to the owner.

Keep mobile navigation compact, controls touch-friendly, charts legible on narrow screens, and tables horizontally scrollable or converted to stacked rows. Respect system/light/dark appearance where supported by the existing app.

## 3. Overview metrics

Show date range and comparison period on every relevant chart. Include:
- Total registered accounts and guests only where a reliable identity/session counter exists.
- Daily/weekly/monthly active users with a documented definition.
- AI requests attempted, succeeded, failed, and success rate.
- p50/p95 latency and timeout rate when enough observations exist.
- Tokens consumed, provider/model breakdown, and estimated USD cost.
- Current estimated spend against daily/weekly/monthly configured budgets.
- Plan mix, upgrades/cancellations and revenue only from verified billing records.
- Current incident count and latest incident.
- Automation jobs by state, where the execution engine emits durable events.
- Data freshness and telemetry coverage indicators.

Do not show placeholder dashes as if data exists. Use explicit states: **Available**, **No data yet**, **Unavailable**, **Stale**, or **Estimated**. Never silently treat missing telemetry as zero.

## 4. AI Operations

Provide filters for date range, plan/tier, provider, model, task/feature, outcome, and request ID. Display:
- request volume, success/failure rate, latency percentiles, timeout rate;
- input/output tokens when the provider reports them, and mark estimates clearly;
- estimated cost using the repository's maintained pricing configuration;
- routing decision, fallback count, and safe error categories;
- feature-level usage (chat, images, voice, web, coding, tools, NCC) only where instrumentation exists;
- budget reservations and settled estimates using existing spend reservation data.

Do not persist prompts, completions, uploaded content, credentials, or raw authorization headers for dashboard telemetry. Correlate events using opaque request IDs. Keep provider names/model identifiers inside the owner view if operationally needed, but never expose internal model details to ordinary user replies.

## 5. Users & Growth

Provide account search and filters with least-privilege fields: internal user ID, created date, plan/tier, status, last activity timestamp, aggregated usage, and consent/retention state only when necessary for support. Mask email addresses by default and reveal only to an authorized owner action if the existing account model requires it.

Show new registrations, active-user trends, retention cohorts, plan changes, feature adoption, and conversion funnels. Clearly define active user and cohort calculations. Avoid profiling sensitive traits. Never use private chat content for behavioral analytics.

Administrative actions such as suspending an account, changing entitlements, or deleting data must not be implemented as casual dashboard toggles. If supported later, require dedicated server-side authorization, explicit confirmation, reason capture, audit events, and reversible workflows where possible.

## 6. Infrastructure & Releases

Integrate existing sources instead of inventing endpoints or environment variables:
- Application health and server route latency/error summaries.
- Vercel deployment/build state only if a verified API integration and credentials are configured.
- Supabase health/database/storage indicators only through supported, scoped server-side queries or provider APIs.
- Release timeline correlated with incident and error trends.
- Current configuration validation that returns only pass/fail and safe key names, never secret values.
- Data-source connection state and last successful poll.

A successful health check does not prove every dependency is healthy. Display the scope and timestamp of each check. Never expose deployment logs or raw provider errors without redaction.

## 7. Security & Audit

Include:
- Aggregated sign-in failures and suspicious request/rate-limit patterns from existing safe events.
- Security findings and CI/dependency/secret-scan status only when a verified data source is connected.
- RLS/authorization regression results from CI or explicit checks, not inferred from dashboard UI.
- An audit log for owner actions: actor ID, action, target type/ID, timestamp, outcome, reason, request ID and safe metadata.
- Incident severity, status, timeline and resolution notes.

Do not store secrets or raw personal content in audit metadata. Audit records must be append-only from normal application paths; do not expose a UI that edits/deletes audit history. Rate-limit and redact sensitive fields.

## 8. Automation & Jobs

Use the existing automation/job model only after code inspection confirms it exists and its semantics. If durable execution events are missing, implement an explicit event model in a separate reviewed phase. Dashboard states must distinguish queued, running, succeeded, failed, canceled, timed out and unknown/stale.

Show run ID, workflow ID, trigger, start/end time, duration, safe step names, retry count and sanitized error category. Do not render full secrets, raw tool arguments, or customer message payloads. Retry/cancel actions must verify ownership/authorization and job state server-side, be idempotent, and require confirmation for side-effecting runs. Never auto-retry non-idempotent writes without a deduplication/idempotency strategy.

## 9. Finance & Costs

- Use existing usage events, spend reservations, pricing configuration and verified payment records.
- Separate actual provider-reported cost, internal estimate, reserved spend, settled spend, gross revenue and estimated operating margin.
- Label any forecasts as estimates with method and period.
- Reconcile payment totals to authoritative payment/webhook records; never infer revenue from plan labels or client UI.
- Alert on configurable thresholds while preserving existing provider-side spending limits, request caps, rate limits, tenant protections and quota behavior.
- Avoid exposing full payment details or financial data to non-owner roles.

## 10. Alerts, incidents and safe controls

Support configurable thresholds for error rates, latency, provider failure, spend, stale telemetry, job backlog and security events. Alert delivery channels are only shown as enabled when configured and verified.

Incident workflow: detect → create/update incident → notify → investigate → propose remediation → owner approval for privileged action → execute through an existing authorized server route → verify → record outcome.

AI may summarize evidence and suggest diagnostic steps. AI must not grant itself permissions, change secrets, deploy code, disable security, delete data, or run arbitrary SQL. Remediation actions must be a predefined allowlist with server-side validation, explicit authorization, confirmation, idempotency, rate limits, audit records, and post-action verification.

Potential controls, only when supported by real backend capabilities:
- pause a provider route or feature via an existing validated feature flag;
- disable a specific integration/workflow;
- maintenance mode with a safe recovery path;
- retry a safe failed job;
- acknowledge/resolve an incident.

Never display a working-looking control when no backend action exists. No dashboard feature may bypass current budget or abuse protections.

## 11. AI incident investigator and release guard

AI investigator:
- summarize only sanitized, timestamped evidence;
- correlate request IDs, safe error categories, provider status, release timeline and job events;
- cite evidence IDs/time ranges for every material conclusion;
- distinguish observed facts from hypotheses;
- recommend a bounded next check and list uncertainty;
- never claim a root cause is confirmed without corroborating evidence.

Release guard:
- show CI, test, database test, secret scan, dependency scan and available evaluation results from real workflow data;
- block or flag releases based on explicit configured policy, not an LLM-only judgment;
- correlate post-release regressions and offer rollback instructions;
- do not deploy or roll back automatically in the first phase.

## 12. Reports and exports

Allow date-scoped CSV exports for aggregated usage, costs, incidents, automation status and growth metrics. Exports must:
- be owner-authorized on the server;
- validate date ranges and row limits;
- omit message contents, tokens/secrets, raw headers and unnecessary PII;
- set safe content types and attachment filenames;
- avoid logging export contents;
- record export creation in the audit log.

Scheduled delivery is a later phase and must use an explicitly configured, verified channel.

## 13. Data model and instrumentation approach

**Do not create tables until the current schema and migrations have been inspected.** Reuse existing sources where possible, including the existing `usage_events`, `spend_reservations`, routing/usage aggregates, account/plan data, and any durable automation events actually present in the checked-out repository. Verify each table and column before querying it.

If instrumentation gaps exist, design additive migrations in a separate implementation PR. Candidate concepts (names are illustrative, not approved schema names):
- privacy-minimized operational events with event type, occurred_at, request ID, outcome, safe dimensions and retention;
- append-only owner audit events;
- incidents and incident updates;
- alert rules and delivery attempts;
- durable job/run event summaries only if the current execution engine lacks them.

Every migration must have database tests and RLS/privilege checks. Default-deny access. Browser clients must not query privileged analytics tables directly. Use authenticated same-origin server APIs and server-side aggregation; service/secret Supabase keys stay server-only. Scope all user/tenant data queries explicitly. Do not broaden policies to make the dashboard work.

Avoid high-cardinality labels and excessive write volume. Define retention and aggregation before storing telemetry. If the change alters data collected, shared, retained, or user rights, update `public/legal/privacy.md` and `public/legal/terms.md` as required by `CLAUDE.md`, and bump the relevant legal version defaults in `src/config.js`.

## 14. Authentication and authorization

- Reuse existing server-side authentication and session validation.
- Create an explicit owner allowlist/role check from a verified authoritative identity; never trust an email, role, or owner flag supplied by the browser.
- Require recent authentication and MFA/step-up verification for destructive or high-impact controls if the current auth provider supports it. Do not claim MFA is active until implemented and verified.
- Return 403 for authenticated non-owners; return safe unauthenticated responses for signed-out users.
- No secrets or Supabase privileged keys in HTML, JavaScript, client responses, URLs or logs.
- Enforce same-origin protections, CSRF defenses where applicable, request size limits, rate limits and strict input validation.
- Do not expose the dashboard route or data to guests or ordinary users.
- Audit denied high-risk attempts without storing secrets or message content.

## 15. APIs and UI behavior

Inspect `src/routes.js`, `src/main.js`, existing auth helpers, static UI patterns and test conventions before naming or creating routes. Prefer a small set of read-only endpoints with bounded filters and server-side aggregation. Proposed endpoint names are not commitments until verified against route conventions.

All endpoints must validate date range, enum filters, pagination, and request IDs. Use stable response schemas with `generated_at`, `data_as_of`, source status, and a clear error code. Do not return stack traces or provider credentials. Avoid N+1 queries and full-table scans; add indexes only after query plans and expected volume are understood.

Refresh intervals must be configurable and conservative; use backoff on errors and visibility-aware polling where supported. Manual refresh should be available. Show stale/offline states and preserve the last successful timestamp without pretending it is live.

## 16. Testing and acceptance criteria

Tests must verify:
- signed-out and guest requests cannot access owner data;
- authenticated non-owner users receive 403 and no metric data;
- owner access is checked server-side on every request;
- query filters, pagination, date bounds, aggregation and empty-data states;
- missing telemetry is not represented as zero;
- sensitive fields, message content, secrets, tokens and headers are absent from responses and logs;
- tenant/account boundaries cannot be crossed;
- rate limits and budget protections remain unchanged;
- audit records are emitted for privileged actions and denied attempts where appropriate;
- retry/cancel controls are idempotent and reject invalid state transitions;
- export authorization, row limits, safe CSV escaping and redaction;
- database RLS and grants are restrictive and covered by database tests;
- mobile UI handles narrow viewport, loading, errors, stale data and no data;
- telemetry write failures do not break normal chat or user requests;
- CI, secret scan, dependency scan, unit tests and DB tests pass.

Acceptance is not met by screenshots, mock data, static cards, or documentation alone. Each metric must trace to a real, verified source and display its freshness. Any unavailable integration must be clearly marked unavailable.

## 17. Phased delivery

### Phase 0 — Repository audit and design
Inspect current branch, working tree, route/auth conventions, schemas/migrations, existing telemetry, UI patterns, Vercel/Supabase integration availability and legal retention. Produce a gap matrix: source exists / needs instrumentation / external integration unavailable. No speculative schema or API names.

### Phase 1 — Secure read-only MVP
Owner-only shell and Overview, AI Operations, Users & Growth using only verified sources. Add missing minimal telemetry only after review. Use safe empty/unavailable states. Add authorization, unit tests and database tests where applicable.

### Phase 2 — Infrastructure, Security & Audit
Add verified deployment/health sources, incident list, audit events and security/CI status. No production mutation controls.

### Phase 3 — Automation & Finance
Add durable job/run visibility and financial reconciliation from verified sources. Add retry/cancel only after idempotency and authorization tests.

### Phase 4 — Alerts and AI investigation
Add threshold alerts, incident correlation, evidence-based AI summaries, release guard, and owner-approved allowlisted remediation. Keep deploy/rollback automated actions disabled until separately approved and tested.

### Phase 5 — Reports and refinements
Add safe exports, scheduled summaries, retention controls, mobile polish and performance improvements.

## 18. Required Claude Code workflow

Claude Code must:
1. Read `CLAUDE.md`, `docs/claude-code-handoff.md`, `docs/operations.md`, relevant auth/routing/data docs, and current code before changing anything.
2. Report current branch, working-tree status, target branch, files planned, production impact and confirmed sources.
3. Work on a dedicated short feature branch; never modify `main` directly.
4. Implement one phase at a time. Do not stop at a mockup or documentation if the approved task is implementation.
5. Keep runtime dependencies at zero (Node 22 built-ins only), per ADR-002.
6. Never run destructive production SQL, expose secrets, change production environment variables, merge, or deploy without explicit owner approval.
7. Update this spec, `CLAUDE.md`, relevant operations docs, tests, migrations and legal docs together when the implementation changes them.
8. Run `npm test`, database tests where available, secret scan, and relevant quality/red-team checks. Report exact commands and outcomes; do not claim unrun checks passed.
9. Deliver a concise report with files changed, actual data sources connected, migration instructions, tests, limitations and owner actions.
10. Keep each PR reviewable and do not mark it complete while required checks fail.

## 19. Explicit non-goals for the first release

- No public analytics endpoint.
- No direct browser access to privileged Supabase data.
- No automatic deployment, rollback, secret rotation, arbitrary SQL, or destructive account action.
- No collection or display of private chat contents for monitoring.
- No invented real-time metrics, fake integrations, mock success states, or claims that MFA/alerts are enabled without verification.
- No new runtime dependencies.


---

# Implementation contract and acceptance gates (2026-10-14)

The sections below are mandatory. This document is an implementation specification, not evidence that these capabilities already exist. Claude Code must implement working application code, APIs, telemetry, migrations where needed, and tests in phases. **A documentation-only PR, static mockup, hard-coded metric, or unconnected button does not satisfy the owner's request.**

## A. Repository discovery before changes

Read `CLAUDE.md`, `docs/claude-code-handoff.md`, `docs/operations.md`, `docs/pr-change-log.md`, auth/store/routing/budget/payment/NCC modules, current routes and UI, all relevant migrations and DB tests, CI, and legal docs. Report current branch and working tree, target branch, live impact, and verified data sources before editing.

Verify actual schema and migration history before writing SQL. The operations guide documents historical migration naming conflicts; never guess the next migration number, renumber migrations, or blindly apply SQL to production. Inspect existing owner/admin screens first to avoid duplicate functionality. Names in this document are conceptual until verified in code.

## B. Non-negotiable security architecture

- Every page, API read, export, and control action must verify owner access server-side using a verified identity and an explicit server-side allowlist/role. Hiding links in the browser is not authorization.
- Guests, signed-out sessions, ordinary accounts, and malformed identities fail closed. Never trust client-supplied role, email, user ID, tenant ID, plan, cost, or totals.
- Reuse the existing server-side Supabase patterns. Never send privileged Supabase credentials to the browser. Do not weaken RLS, grants, rate limits, budgets, tenant checks, authentication, retention, or consent to make the dashboard work.
- If MFA/step-up authentication is not supported by the current flow, verify that fact, document the risk, and keep destructive/high-impact actions disabled until suitable protection exists. Do not claim MFA is active unless it is implemented and tested.
- Protect state-changing requests using the repository's CSRF/origin/session pattern, strict input validation, rate limits, and idempotency keys where needed.
- Record owner actions in append-only audit events with actor, action, target, timestamp, outcome, reason, and correlation ID. Never record secrets, raw tokens, full prompts, private messages, or raw provider payloads.
- No LLM may execute arbitrary SQL/shell commands, change secrets, merge, deploy, roll back production, or disable security. AI can recommend a tested patch and explain evidence; a human approves privileged action.
- Preserve Node 22 built-ins only (ADR-002); no new runtime packages without explicit approval. Preserve strict CSP and current frontend conventions.

## C. Metric definitions and telemetry

First reuse verified current sources. The operations guide references `public.usage_events`, `public.routing_daily`, and `public.spend_reservations`; verify live schema, migration status, grants, and semantic meaning before use. Reuse verified auth/account, payment, NCC execution and outbox data where available. Never create duplicate ledgers.

Where required data is missing, instrument only the minimum safe events. A common event envelope should include UTC timestamp, opaque event ID, schema version, event type, correlation/request ID when available, actor class, validated feature/task/provider/model dimensions where useful, outcome category, latency, provider-reported token counts and estimated cost only when available, and a sanitized error code. Use idempotency to prevent retries from inflating logical-request counts. Do not store message content, prompts, completions, credentials, auth headers, or unnecessary PII.

Definitions:
- Registered users: verified accounts in the authoritative auth source; guests are separate.
- Active users: distinct authenticated accounts with a documented qualifying event in the selected window.
- AI requests: show logical user requests separately from provider attempts/fallbacks where data allows.
- Success/error rate: disclose denominator and excluded outcomes.
- Latency: show sample size; do not imply reliable percentiles with insufficient observations.
- Tokens: provider-reported counts where available; estimates must be labeled.
- AI spend: distinguish reserved, estimated, and invoiced/actual amounts; price calculations use versioned repository pricing.
- Revenue: verified settled payment records, separate from pending, failed, refunded, and chargeback amounts when supported. Never infer revenue from plan labels.
- Profit/margin: estimate only when both revenue and cost coverage are adequate; disclose exclusions.
- Retention/churn: disclose cohort, eligibility, activity definition, window, and missing-data handling.
- Health: show measured source, scope and timestamp. A single successful health endpoint is not proof all dependencies are healthy.

Store timestamps in UTC; bucket daily summaries using the documented Asia/Manila reporting timezone unless existing product conventions require otherwise. Test day-boundary behavior. Missing, stale, unavailable, and true zero must be separate states.

## D. Detailed module acceptance requirements

### D1. Executive overview
Real-source KPI cards for registered/active users, AI requests, success/error rate, latency, estimated AI cost, verified revenue when available, estimated margin when valid, system health, open incidents and job backlog. Date-range filters, comparison periods, source/freshness labels and links to filtered detail views. Never display fake or hard-coded production values.

### D2. AI operations center
Filter by date, tier, provider/model, task/feature, outcome and correlation ID. Show requests versus attempts, tokens, estimated costs, latency, failures, timeouts, routing/fallback distribution, tool outcomes and spend reservations. Safe redacted diagnostics only. Do not expose prompts, completions, secrets or hidden reasoning.

### D3. User intelligence and CRM
Paginated account search with minimum fields, plan/subscription state only when verified, last activity, aggregate usage, feature adoption and retention/cohorts. Mask PII by default. Never display private chats as analytics. Account support actions require separate authorization, confirmation and audit.

### D4. Infrastructure and deployments
Show application/API health, measured latency, last successful check, and Vercel deployment/build data only if a real authorized integration is configured. Supabase health must be measured by safe checks/provider APIs. Show configuration status (present/missing/validity) without secret values. Unavailable integration = **Not connected**, not green.

### D5. Security and audit
Aggregated auth failures, authorization denials, rate-limit blocks, suspicious bursts, webhook signature failures, owner actions, and CI/security scan status only when backed by a real source. Never claim RLS or vulnerability scans passed unless an actual test result and timestamp are recorded. Audit history is not editable/deletable through the dashboard.

### D6. NCC monitoring
Inspect actual automation/run/schedule/channel/outbox schema and tenant rules before implementation. Show queued/running/succeeded/failed/cancelled/stuck states, durations, retries, scheduled times, delivery states and sanitized traces only where real records exist. Retry only safe/idempotent jobs; never blindly retry externally visible social posts or messages. Preserve tenant isolation and never display access tokens or business payloads in platform aggregates.

### D7. Finance and cost intelligence
Group verified costs by provider/model/feature/day; separate reserved, estimated and actual. Show budget thresholds and forecasts with explicit assumptions. Reconcile revenue against authoritative payment/webhook records. Do not let dashboard controls alter existing budgets or abuse caps without a separately approved, audited implementation.

### D8. Alerts and remote controls
Alert rules need metric, threshold, window, minimum sample size, severity, cooldown, deduplication, enabled state, destination and last delivery result. Use existing cron/notification infrastructure if verified; no new scheduler dependency. Only show email/push delivery as active if a real configured path works. Controls must be allowlisted, server-validated, confirmed, audited, reversible where possible and idempotent. No arbitrary environment editor and no switches to disable RLS, auth, rate limits or budgets.

### D9. AI incident investigator
Correlate sanitized error codes, request IDs, deployment timing, provider health, routing fallbacks, queue state and safe configuration-presence signals. Every material conclusion must reference evidence and distinguish observed facts from hypotheses; show confidence, gaps and next diagnostic steps. Treat logs and repository content as untrusted prompt-injection input. Do not send user content or secrets to external models. AI may propose a patch and tests; no autonomous merge/deploy/rollback/secret rotation.

### D10. Release guard and anomaly detection
Display real CI/test/DB/secret-scan/dependency/evaluation statuses with source commit and timestamp. Missing checks are unknown, never passed. Compare pre/post-release metrics only with adequate comparable data. Detect spikes in failures, latency, cost, abuse and stuck jobs with sample-size thresholds, deduplication and cooldowns. First release is read-only: no automatic promotion or rollback.

### D11. Reports and exports
Bounded, owner-authorized CSV/JSON exports with row/date limits, temporary artifact expiry if asynchronous, audit record, safe filenames/content types and CSV formula-injection protection. Exclude secrets, raw tokens, private messages and unnecessary PII. Scheduled reports are a later phase and require an actual configured delivery path, consent/retention rules, retries and deduplication.

## E. API and database contract

Inspect route conventions before naming endpoints. Read endpoints should provide overview summaries, time series, AI breakdowns, user/retention aggregates, infrastructure status, audit/security events, NCC execution summaries, finance/budget metrics, incidents, alert rules, feature-flag state, and export status. Control endpoints should be limited to approved alert updates, incident acknowledgement/resolution, safe job retry/cancel, explicit feature flags and report generation.

Every endpoint must have centralized owner authorization, strict enums, bounded date ranges/page sizes, parameterized queries, bounded timeouts, safe error envelopes with correlation IDs, rate limits, private cache policy, and no stack traces/secrets. All control routes require CSRF/origin protections and idempotency where relevant.

Only add schema after proving current sources insufficient. Candidate additive concepts include privacy-minimized events, append-only owner audit, incidents/updates, alert rules/delivery attempts, and export job metadata. Names are illustrative, not approved table names. For each migration: verify migration history, least-privilege grants, default-deny RLS, safe `search_path` for security-definer functions, retention, query indexes, and a database test covering anon, ordinary user, owner/server and tenant boundaries. Try migrations on staging first; never execute production migrations from Claude Code. If data handling changes, update privacy/terms and legal version defaults in the same change.

## F. Testing gates and definition of done

Required tests include:
- signed-out, guest and non-owner denial for every read/control/export path;
- owner authorization checked on the server every time;
- cross-user/cross-tenant isolation and no sensitive fields in responses/logs/exports;
- metric math, retries/deduplication, estimates versus actuals, refunds and timezone boundaries;
- validation, pagination, SQL injection, XSS, CSV injection, CSRF, replay, rate limits and expensive-query bounds;
- alert thresholds, minimum samples, deduplication, cooldown, stale telemetry and failed delivery;
- control allowlists, audit trail, stale-write conflicts and recovery;
- NCC retry idempotency and duplicate external-delivery prevention;
- AI investigator prompt injection and no autonomous high-impact action;
- UI loading/empty/error/stale/unavailable states, accessibility and mobile Safari;
- database RLS, grants, safe function search paths and retention.

Follow current handoff requirements: `npm test`, `npm run check:secrets`, `db/tests/run.sh`, GitGuardian and Vercel preview where configured. State exact commands and observed results; unavailable checks must be marked not run, never passed by implication. Do not hand off with required checks failing or pending.

## G. Staged delivery — real implementation required

1. **Phase 0 — discovery:** source-of-truth map, existing UI/auth/schema/migration/telemetry audit, integration availability and gap list. No speculative schema or production changes.
2. **Phase 1 — secure read-only MVP:** owner-only responsive shell, central authorization, overview, AI usage/cost summaries and user aggregates backed by verified data. Add minimal instrumentation only for proven gaps.
3. **Phase 2 — operations:** AI model/routing details, finance reconciliation, security/audit and verified infrastructure/deployment status.
4. **Phase 3 — NCC monitoring:** actual durable job/run/outbox status, safe traces and idempotent retry/cancel only after tests.
5. **Phase 4 — incidents and alerts:** thresholds, anomaly detection, release guard and evidence-based AI investigation; no autonomous deployment.
6. **Phase 5 — approved controls and reports:** audited allowlisted controls, bounded exports and scheduled reports only after delivery integrations are verified.

Stop for owner approval before beginning each new phase, as required by `CLAUDE.md`. For every phase, deliver code, tests, updated `docs/pr-change-log.md`, and legal docs if needed. Never merge or deploy without owner approval.

## H. Rollback and handoff report

New read paths must be disableable without affecting chat, authentication, billing, AI routing, Connect or NCC. Optional integrations fail closed. New controls remain disabled until verified. Do not use disabling RLS/rate limits/budgets as rollback.

At each phase end, report in plain language: implemented behavior; changed files/migrations; real/estimated/unavailable sources; owner authorization and RLS tests; exact test commands and observed results; required owner actions; limitations and risks; and the next phase awaiting approval. Documentation or screenshots alone are not completion.

## I. Owner-approved visual direction — premium, lively, restrained

The owner prefers a premium interface with more life than a strict monochrome or two-color design, but without a rainbow-like, overly colorful appearance. This visual direction is the implementation target for the Owner Command Center.

### I.1 Palette and color roles

Use a light, neutral foundation with a controlled multi-accent palette:

- **Foundation:** white surfaces, soft cool-gray page backgrounds, subtle gray borders, and restrained shadows.
- **Typography:** navy and charcoal for headings/body text; muted slate for secondary labels and metadata.
- **Blue:** primary navigation state, links, primary actions, and user-growth data.
- **Emerald green:** healthy systems, successful operations, verified positive trends, and revenue series when semantically appropriate.
- **Violet:** AI/model activity and AI-tier visualization.
- **Amber:** spend/cost indicators, budget warnings, and attention-needed states.
- **Coral/red:** critical failures, security incidents, and destructive-action warnings only.
- **Neutral slate/gray:** supporting series, inactive states, separators, and secondary data.

These are semantic roles, not a requirement to use every accent in every view. Keep the majority of each screen neutral. Use accent colors to distinguish meaningful categories, not as decoration. Avoid neon colors, rainbow gradients, glowing cards, saturated full-card backgrounds, and arbitrary colors with no consistent meaning. Maintain readable contrast and do not rely on color alone to communicate status.

### I.2 Components and hierarchy

- Use spacious, consistently aligned cards with restrained borders, subtle depth, and clear typographic hierarchy.
- KPI cards may use a small colored icon, a thin trend line, or a small accent detail; keep the card surface neutral.
- Charts may use multiple coordinated colors when comparing distinct series. Keep gridlines and axes quiet, labels legible, legends explicit, and tooltips accessible.
- Use soft tinted badges for plan tiers, statuses, and categories, with restrained saturation and accessible text contrast.
- Reserve strong red emphasis for genuine critical events. Warnings use amber; healthy states use green; neutral/unknown states remain gray.
- Keep navigation icons consistent in style and size. Selected navigation may use a very light blue tint, not a large saturated block.
- Avoid unnecessary gradients, animated decoration, excessive shadows, or dense data walls. Motion, if any, must be subtle and respect reduced-motion preferences.

### I.3 Layout and responsive behavior

- Default to a polished light theme for the initial implementation, while respecting existing theme support and avoiding regressions in dark/system modes.
- Design mobile-first for Safari on iPhone: readable KPI cards, touch targets of comfortable size, compact/collapsible navigation, charts that remain legible, and tables converted to stacked rows or intentionally scrollable regions.
- Establish clear priority: executive KPIs first, trends second, recent activity and alerts third, module shortcuts after the primary information.
- Provide accessible focus indicators, keyboard operation, semantic labels, and contrast compliant with the project's accessibility standards.
- Use skeleton/loading states sparingly and include clear empty, unavailable, stale, and error states. Never style missing telemetry to look healthy.

### I.4 Data visualization rules

Color must reinforce meaning consistently across modules. Do not assign the same color different meanings within the same chart or view. Distinguish revenue from cost, successful from failed operations, and AI tiers from one another. Pair color with labels, icons, line patterns, or status text for accessibility. Avoid misleading axes and exaggerated trends.

### I.5 Design acceptance criteria

The design is accepted only when:
1. The result feels premium and lively without looking childish, cluttered, or overly colorful.
2. Neutral surfaces and typography dominate; blue, emerald, violet, amber, and coral are used sparingly and consistently by semantic role.
3. KPI cards, charts, badges, alerts, and navigation share a coherent visual system.
4. The layout is usable on narrow iPhone screens and desktop widths, including loading/error/empty states.
5. Contrast, focus, labels, reduced motion, and non-color status cues are covered.
6. Any preview/mockup uses clearly labeled illustrative data; production metrics must come from verified sources.

This section supersedes any interpretation of the earlier design notes that would result in a strictly monochrome/two-color interface or an excessively colorful interface. It does not change the security, telemetry, phased-delivery, testing, or owner-approval requirements above.

## J. Owner navigation visibility: server-configured email and IP allowlists

The Owner Command Center navigation button must be rendered only when the server-side owner-eligibility check succeeds. The button is a convenience, not an access-control boundary. Every owner page request and every dashboard API request must independently enforce the same authorization policy.

### J.1 Required environment configuration

Use server-only environment variables, with names confirmed against existing repository conventions before implementation:

- `OWNER_ALLOWED_EMAILS`: comma-separated exact email addresses for approved owner identities.
- `OWNER_ALLOWED_IPS`: comma-separated exact IP addresses and, only if deliberately implemented and tested, supported CIDR ranges.

These are proposed names until Phase 0 verifies the existing configuration conventions. Never expose their values in browser code, HTML, API responses, client-visible configuration, logs, or error messages. Never commit real values to the repository. Configure them only through the hosting provider's protected environment settings after the owner explicitly approves the change.

If either required variable is missing, blank, malformed, or fails validation, fail closed: do not render the owner button and deny access to the owner page and APIs. Do not fall back to a hard-coded owner email/IP, a client-provided value, or a permissive default. Show no sensitive configuration details to ordinary users.

### J.2 Eligibility and request validation

- Require both an exact verified signed-in email match and an approved client IP match before showing the button or granting access.
- Normalize email addresses safely and compare against the authenticated identity returned by the trusted server-side auth flow, not a request parameter or browser profile field.
- Resolve client IP only using the platform's documented trusted-proxy mechanism. Do not blindly trust arbitrary `X-Forwarded-For`, `X-Real-IP`, or similar client-controlled headers. If the platform's trusted IP cannot be established, deny owner access.
- Support IPv4/IPv6 correctly; reject malformed allowlist entries. Do not infer the user's IP from a location service.
- Re-evaluate email, IP, and authenticated session on every owner page/API request. A hidden button must never be the only protection.
- Return a safe denial (for example, 403 for an authenticated but ineligible user); do not reveal which allowlist check failed.
- Keep secrets and allowlist values server-only. Audit denied owner-route access using safe metadata without storing session tokens or unnecessary personal data.
- Document operational caveats: IP allowlists can block the owner when a mobile carrier, VPN, Wi-Fi network, or public IP changes. Provide a secure server-side update procedure; never add a browser-side bypass or automatic open access fallback.

### J.3 Required tests

Test that the button is absent and all owner endpoints deny access when configuration is missing/invalid; both allowlist matches are required; either mismatch denies access; forged identity/IP headers do not grant access; trusted-proxy handling is correct; IPv4/IPv6 entries are validated; changing networks takes effect; and ordinary users cannot learn allowlist contents. Test server authorization separately from UI visibility.

No production environment variables are to be created or changed by this documentation update. Actual configuration and implementation require their own reviewed, explicitly approved steps.


## K. Owner-only 404 boundary, defensive controls, and operational readiness (2026-10-14)

This section consolidates the additional owner requirements identified during the security review. It supplements Sections 14, 16, 17, J, and `docs/owner-command-center-404-policy.md`. If older wording conflicts with this section, this section governs the Owner Command Center.

### K.1 Uniform 404 for unauthorized visitors

- The proposed owner route is `/owner`; confirm the final route against existing routing conventions during Phase 0.
- Every unauthorized direct page request must receive an actual HTTP `404 Not Found`, not merely a client-side redirect or a page that visually resembles a 404.
- Use the same generic 404 behavior for signed-out visitors, guests, unapproved identities, unapproved IPs, missing/invalid allowlist configuration, and requests where a trusted client IP cannot be established.
- Apply the same generic 404 to all owner-only API, metrics, export, alert, audit, incident, automation, and control endpoints. Do not leak data in status bodies, headers, server-rendered markup, error details, or alternate routes.
- Authorized access requires a valid trusted session, a verified authenticated identity matching `OWNER_ALLOWED_EMAILS`, and a trusted client IP matching `OWNER_ALLOWED_IPS`. Both lists must be present and valid. The UI button is only a convenience; it never grants permission.
- Validate all route variants and encodings, including trailing slashes and case/normalization behavior. Use private/no-store caching for owner responses where appropriate; ensure shared caches and static asset delivery cannot expose protected data.
- Do not reveal which check failed. Log only minimized safe metadata when useful; never log secrets, session tokens, full request headers, or unnecessary personal data.
- This 404 policy supersedes earlier generic language in Section 14 and Section 16 that suggests returning 403 or another response to an unauthorized Owner Command Center visitor. The rest of the authentication and authorization requirements remain mandatory.

### K.2 Owner identity, trusted IP, and recovery

- Derive the owner identity from the existing server-validated authentication flow, never from request parameters, client state, browser profile fields, or an unverified role flag.
- Use only the hosting platform's documented trusted mechanism to resolve the client IP. Never blindly trust caller-supplied `X-Forwarded-For`, `X-Real-IP`, or equivalent headers.
- Validate IPv4 and IPv6 allowlist entries. Support CIDR only if intentionally implemented, documented, and covered by tests; otherwise accept exact addresses only.
- If a mobile carrier, VPN, Wi-Fi change, or dynamic public IP blocks the owner, use a secure out-of-band hosting configuration update and redeploy/restart as required by the platform. Never add an automatic open-access fallback, query-string bypass, browser-side override, or hard-coded backup identity.
- Keep `OWNER_ALLOWED_EMAILS` and `OWNER_ALLOWED_IPS` server-only. Actual production configuration changes require explicit owner approval and must not be included in documentation-only work.

### K.3 Session and sensitive-action protections

- Reuse current secure session and cookie patterns; test expiration, sign-out, revoked sessions, stale sessions, and authorization after account changes.
- Apply CSRF protections and same-origin/origin validation to state-changing routes where applicable; use strict input validation, bounded request sizes/timeouts, and rate limits.
- Require explicit confirmation, a reason where appropriate, idempotency protection, and append-only audit events for sensitive actions.
- Require recent authentication and MFA/step-up verification for high-impact actions if supported by the existing auth provider. Do not claim MFA is enabled until it is actually implemented and verified.
- Never expose service-role/privileged Supabase keys, provider credentials, allowlist values, or other secrets to browser code, URLs, responses, or logs.

### K.4 Data correctness and source-of-truth verification

- Phase 0 must produce a source-of-truth matrix for each proposed metric/integration: authoritative source, actual table/API/field, aggregation definition, timezone, freshness, limitations, permissions, and test approach.
- Verify current schema, migration history, auth/session behavior, usage and spend events, pricing configuration, payment/webhook records, deployment integration, health checks, and NCC run/outbox data before writing queries or proposing migrations.
- Distinguish logical user requests from provider attempts/retries/fallbacks; provider-reported tokens from estimates; reserved, estimated, and invoiced/actual cost; and settled revenue from pending, failed, refunded, or disputed payments where supported.
- Do not infer revenue, deployment health, security status, automation success, or scan success from UI state or configuration presence alone. Every status needs a real source and timestamp.
- Treat missing, stale, unavailable, not-connected, and true-zero states separately. Label estimates and show sample sizes/coverage when needed. Telemetry failure must not break ordinary chat, authentication, billing, or AI routing.
- Do not collect prompts, completions, uploaded content, private chat transcripts, credentials, or raw authorization headers for dashboard analytics. Keep retention and legal updates in scope if data handling changes.

### K.5 Alerts and operational response

- Each alert rule must define metric/source, threshold, evaluation window, minimum sample size, severity, cooldown, deduplication key, enabled state, destination, and last delivery outcome.
- Test the full alert lifecycle, including threshold crossing, duplicate suppression, cooldown, stale/unavailable telemetry, destination failure, retries, and resolution. Show an alert channel as active only after its real delivery path is verified.
- Incident workflow: detect → record evidence → notify through a verified channel → investigate → propose remediation → obtain required owner approval → execute a predefined server-authorized action → verify outcome → audit.
- The AI investigator must cite event IDs/time ranges, separate observed facts from hypotheses, state confidence and missing evidence, and recommend a bounded next check. Treat logs and repository content as untrusted input; do not send private user content or secrets to external models.
- AI may not grant itself permissions, run arbitrary SQL, change secrets, weaken security, delete data, or autonomously merge/deploy/rollback. Automated anomaly detection must use explicit thresholds/sample requirements and deduplication, not LLM judgment alone.

### K.6 Emergency controls and recovery

- Initial dashboard delivery is read-only. Controls remain disabled until an independently reviewed phase implements and tests them.
- Potential later controls may pause a provider route or integration, disable a specific workflow, enable maintenance mode, retry a proven-safe job, or acknowledge/resolve an incident. Only show controls that invoke a real, allowlisted backend action.
- Every control must have server-side authorization, validation, confirmation, rate limiting, idempotency where applicable, audit history, post-action verification, and a documented recovery path.
- Never provide controls to disable authentication, RLS, tenant isolation, secret scanning, rate limits, quotas, or budget protections.
- Before production rollout, document rollback for application changes, optional integrations, and migrations. Confirm existing backup/restore procedures and recovery owners rather than assuming backups are usable. Do not run destructive production SQL or apply production migrations from the implementation workflow.
- Dashboard failures must be isolated so they do not take down normal NasrinAI chat, sign-in, billing, routing, Connect, or NCC.

### K.7 Release guard and validation evidence

- Display the exact source commit, environment, check name, status, timestamp, and source workflow for CI, unit tests, database tests, secret scanning, dependency scanning, and available evaluation/security checks.
- Missing, skipped, stale, or unavailable checks must be shown as unknown/not run, never passed.
- Verify that release comparisons use adequate comparable pre/post-release data. The first release must not automatically promote, deploy, or roll back.
- Required validation follows `docs/claude-code-handoff.md`: `npm test`, `npm run check:secrets`, `db/tests/run.sh`, GitGuardian, and Vercel Preview where configured. Report exact observed outcomes; do not imply that checks ran if they did not.
- Test the actual HTTP status and response body for unauthorized routes; screenshots alone are insufficient.

### K.8 Mobile, accessibility, and network changes

- Test on iPhone Safari and desktop, including signed-out and expired sessions, narrow viewport, charts/tables, keyboard/focus, touch target size, loading/error/empty/stale states, and reduced-motion behavior.
- Keep the existing premium restrained multi-accent design direction. Color is semantic and must be paired with text/icons/patterns; do not make status depend on color alone.
- Test approved-IP behavior across Wi-Fi, mobile data, and VPN changes. The owner must understand that an IP allowlist can temporarily lock them out when the public IP changes; the recovery path must not weaken authorization.

### K.9 Phase 0 deliverable and implementation order

Before building dashboard modules, Phase 0 must deliver:
1. A current branch/worktree and architecture summary.
2. An owner security boundary map covering page, API, export, and control routes.
3. A source-of-truth matrix and gap list for all metrics/integrations.
4. A schema/migration/RLS/tenant-isolation review.
5. A trusted-proxy/IP resolution plan and secure owner recovery procedure.
6. A test matrix covering uniform 404, identity/IP mismatch, forged headers, configuration failure, data leakage, and session expiration.
7. A phased PR plan with production impact, rollback, required owner decisions, and exact checks to run.

Implementation order: (1) security boundary and HTTP 404 tests; (2) read-only live-data MVP; (3) infrastructure, security/audit, and verified finance; (4) NCC monitoring; (5) alerts and AI investigation; (6) owner-approved controls and exports. Stop for owner approval before each new phase. Do not merge, change production environment variables, apply production migrations, or deploy without explicit owner approval.


## L. Complete date, sorting, and filtering specification

This section makes date navigation, filtering, sorting, and comparison mandatory across every applicable dashboard module. These controls are part of the product requirements, not optional visual polish.

### L.1 Shared date-range selector

Provide a consistent, accessible date selector at the top of the dashboard and retain the selected range while navigating between modules. Include these one-tap presets:

- **Today**
- **Yesterday**
- **Last 7 days**
- **This week**
- **Last week**
- **Last 30 days**
- **This month**
- **Last month**
- **Last 90 days**
- **This year**
- **Last year**
- **All time**, only for datasets where an unbounded range is safe and meaningful
- **Custom range**, with explicit start and end dates

The UI must explicitly expose **Day / Week / Month / Year** grouping for time-series charts. A date preset and a chart grouping are separate concepts: for example, a 90-day range may be grouped by day, week, or month. Do not silently change the selected range when grouping changes.

Use the product's documented business timezone consistently for calendar boundaries. The default business timezone for dashboard date interpretation is **Asia/Manila**, unless repository conventions establish a different explicit product-wide timezone; Phase 0 must verify and document this. Store event timestamps in UTC where the existing data model supports it, and convert only for display and calendar-boundary aggregation. Avoid mixing UTC dates and Manila calendar days in one chart.

Custom ranges must validate start <= end, reject malformed dates, enforce documented maximum range and query-cost limits, and explain when a range is too large. Handle daylight-saving boundaries for any supported timezone. Show the effective timezone and selected dates so the owner can interpret the numbers correctly.

### L.2 Comparison behavior

For supported metrics, offer comparison with the immediately preceding equivalent period, such as:
- today versus yesterday;
- this week versus the previous week;
- this month versus the previous month;
- this year versus the previous year;
- a custom range versus a preceding range of the same duration.

Display the absolute difference and percentage change only when both periods have valid comparable data. Define behavior for a zero baseline, partial current periods, missing coverage, and refunds/late-arriving events. Never display an infinite or misleading percentage. Label partial periods and estimates. A comparison must use the same metric definition, timezone, filters, and source semantics on both sides.

### L.3 Filter model and application

Provide module-specific filters with consistent placement, clear active-filter chips, **Clear all**, reset-to-default behavior, and visible result counts where feasible. Apply all selected filters consistently to KPI cards, charts, tables, pagination totals, and exports. Server-side validation is authoritative; client-side filtering alone is not sufficient for protected or large datasets.

Common filters, only where supported by verified source data:
- date range, time grouping, and comparison period;
- status/outcome/severity;
- provider, model, AI tier/plan, feature/task, and route;
- account/user identifier, account status, plan, and registration/activity range;
- deployment/environment/commit/check status;
- automation/workflow, trigger, run status, and integration/channel;
- incident/alert severity, state, source, and acknowledgement;
- finance category, provider, payment status, currency, and transaction period;
- data source, freshness, and telemetry availability.

Do not offer a filter that is not backed by a real field. Show unavailable integrations as unavailable, not as an empty successful result. Protect PII in filter controls and autocomplete. Do not expose private message content as a searchable field.

### L.4 Sorting behavior

Tables must provide accessible sort controls for columns where ordering is meaningful. Support ascending and descending order for timestamps, numeric values, and text; use status/severity priority ordering where defined. Examples include:
- newest/oldest event, account, incident, deployment, and automation run;
- highest/lowest requests, tokens, latency, error rate, and estimated cost;
- highest/lowest revenue, refund amount, or spend when authoritative values exist;
- alphabetical name/provider/model/workflow sorting;
- critical-to-low severity and unresolved-to-resolved incident ordering.

Define a stable deterministic secondary key for equal values. Show the active sort column and direction, and keep sort state while paging. The server must whitelist sortable fields; never concatenate arbitrary client input into SQL. Reject unknown sort keys and directions safely. Sorting and filtering must not bypass owner authorization, row-level/tenant boundaries, or export restrictions.

### L.5 Pagination, search, and exports

- Use bounded server-side pagination for large datasets; define a safe maximum page size and stable cursor/ordering strategy where appropriate.
- Preserve filters and sort order while paging, refreshing, and returning from a detail view.
- Search only indexed, explicitly approved metadata. Debounce UI requests where appropriate, rate-limit server requests, and do not run unrestricted full-table scans.
- Display total count only when the source can calculate it accurately within an acceptable cost; otherwise identify it as approximate or omit it.
- CSV exports must use the exact active date range, timezone, filters, and sort order, with an export summary stating those settings and the generation timestamp.
- Re-validate range, filters, sort fields, authorization, and row limits server-side at export time. CSV-escape formula-leading values and redact unnecessary personal information.
- Scheduled reports must declare their timezone, recurrence, filters, destination, retention, and last delivery outcome; only offer schedules supported by a verified delivery mechanism.

### L.6 Module filter matrix

| Module | Required filters | Useful sort orders |
| --- | --- | --- |
| Overview | date range, day/week/month/year grouping, comparison | KPI trends by change; latest incidents |
| AI Operations | date, provider, model, tier, feature, outcome, request ID | newest, highest cost/tokens/latency, failures |
| Users & Growth | registration/activity dates, plan, account status, feature adoption | newest/oldest, activity, usage |
| Infrastructure & Releases | date, environment, deployment, commit, check status, source | newest release, slowest endpoint, failed checks |
| Security & Audit | date, severity, event type, outcome, actor identifier where permitted | newest, severity, failed/denied events |
| Automation & Jobs | date, workflow, trigger, status, integration/channel | newest, longest-running, failed, retry count |
| Finance & Costs | date, category, provider, payment state, currency | highest/lowest spend, newest transaction, reconciliation exceptions |
| Incidents & Alerts | date, severity, state, source, acknowledgement | severity, newest, longest open |
| Reports & Exports | range, report type, status, owner-approved destination | newest, status |
| Settings | setting category/status; never filter or display secret values | category, status |

This matrix is a requirement, not proof that each underlying data source exists. Phase 0 must map each filter to a verified source field or explicitly mark it as blocked pending instrumentation.

### L.7 Date/filter/sort acceptance tests

Test every preset and custom range; start/end validation; timezone boundaries; day/week/month/year grouping; previous-period comparisons; empty and partial periods; stale or unavailable sources; filters combined across charts/tables/exports; clear/reset behavior; stable sorting and pagination; invalid/unknown sort keys; oversized date ranges; export consistency; and attempts to request another account's data. Include leap days and year/week boundaries. The UI must remain usable on iPhone Safari without tiny targets or a horizontally overflowing filter toolbar.

## M. Architecture guide and implementation blueprint

The architecture below is the target design guide. It must be reconciled against the actual repository during Phase 0 before naming routes, creating modules, or applying migrations. It is not a claim that these components already exist.

### M.1 Architectural principles

1. **Server-authoritative security:** all owner authorization, allowlist checks, filtering, aggregation, exports, and control validation occur server-side.
2. **Read-only first:** initial release observes verified sources; write/control features are separate, later, explicitly approved phases.
3. **Reuse before create:** use current route, auth, telemetry, pricing, billing, deployment, and automation patterns where they are real and suitable.
4. **No fake data:** every value has a source, definition, timestamp, and state; mock data is permitted only in clearly isolated tests/previews.
5. **Failure isolation:** dashboard or telemetry failure must not interrupt ordinary chat, sign-in, billing, AI routing, Connect, or NCC.
6. **Least privilege:** no browser access to privileged analytics tables or service-role credentials; no broad RLS changes to make dashboards work.
7. **Bounded work:** bounded date ranges, pagination, request sizes, query costs, refresh rates, retries, and export sizes.
8. **No new runtime dependencies:** follow ADR-002 and the repository's Node 22 built-in-only rule.
9. **Observable but privacy-minimized:** record operational metadata, not private conversation content.
10. **Reviewable delivery:** one approved phase per PR, with exact checks and rollback instructions.

### M.2 Logical architecture and request flow

```text
Owner on mobile/desktop
        |
        v
Existing app shell + owner navigation
(button shown only after server-confirmed eligibility)
        |
        v
Owner page route /owner
        |
        v
Shared server-side owner guard
  - trusted session and verified identity
  - OWNER_ALLOWED_EMAILS match
  - trusted-proxy-derived IP and OWNER_ALLOWED_IPS match
  - fail closed; generic HTTP 404 if unauthorized
        |
        v
Owner API handlers (each re-runs the guard)
  - schema/enum/date validation
  - bounded pagination, sort allowlist, rate limits
  - same-origin/CSRF controls for mutations
        |
        v
Domain query/service layer
  - metric definitions and aggregation
  - source freshness and coverage
  - safe redaction and response schema
        |
        +------> Verified existing application telemetry
        +------> Usage, routing, token and spend records
        +------> Verified account/plan/billing records
        +------> Verified deployment/CI/health integrations
        +------> Verified NCC workflow/outbox/run events
        |
        v
Typed/validated response with generated_at,
data_as_of, source status, coverage, and limitations
        |
        v
Charts, KPI cards, tables, incident timeline, exports
```

This diagram is conceptual. The exact modules, APIs, schemas, and integrations must be discovered in the current repository; do not create a second authentication system or duplicate an existing data pipeline without justification.

### M.3 Recommended server-side boundaries

During Phase 0, map these responsibilities to existing modules and conventions. Proposed names below are conceptual only:
- **Owner guard:** one shared server-side function for verified session, allowlisted email, trusted IP, fail-closed configuration, and uniform 404 behavior.
- **Request validation:** parse and validate date range, timezone, grouping, filters, sort key/direction, page/cursor, and requested export.
- **Metric/query services:** module-specific bounded queries and aggregations; no route should embed ad hoc unrestricted SQL.
- **Source adapters:** isolated adapters for each verified data source with timeout, redaction, source status, and freshness.
- **Response contract:** stable, versionable response fields such as `generated_at`, `data_as_of`, `timezone`, `range`, `source_status`, `coverage`, `items`, `pagination`, and safe error codes where appropriate.
- **Audit writer:** append-only audit events for access denials and privileged actions, with no secrets or content payloads.
- **Alert evaluator/delivery:** deterministic threshold evaluation and deduplication, independent of LLM judgment.
- **Export service:** same filters and aggregation rules as the UI, with independent server authorization and safe CSV handling.
- **UI state:** one shared date/filter/sort state model where consistent, with module-specific filters and accessible loading/error/stale/empty states.

Do not add these as duplicate modules if equivalent repository components already exist. Document the actual mapping before implementation.

### M.4 API contract requirements

Discover route conventions first. Any proposed owner endpoint must:
- be same-origin and server-authorized independently on every request;
- return a genuine generic HTTP 404 for unauthorized requests, without protected content;
- validate all query parameters and allowlist filter/sort values;
- enforce date and page limits, request timeouts, rate limits, and safe error responses;
- scope every query to the authorized owner/admin context and any relevant tenant/account boundary;
- return the selected range/timezone, generation timestamp, data freshness, source availability, and explicit estimate/coverage metadata;
- avoid stack traces, secrets, raw provider errors, SQL errors, private messages, and raw request headers;
- use private/no-store cache behavior for sensitive responses where appropriate;
- be tested directly at the HTTP boundary, not just through component tests.

Use GET for read-only queries where the repository's patterns support it. Use POST with CSRF/origin checks for state-changing actions or export creation where required. Never put credentials, allowlist values, or sensitive filters in URLs. Do not expose a generic SQL/query endpoint.

### M.5 Telemetry and aggregation lifecycle

1. A real application/provider/job event occurs.
2. Existing instrumentation emits a minimal, validated event or records the result in the existing durable source.
3. The event is stored with UTC timestamp, opaque correlation ID, outcome, safe dimensions, and schema/version where needed.
4. Aggregation/query services apply the documented time boundaries and filters.
5. The API returns data plus source freshness/coverage and whether numbers are actual, estimated, unavailable, or stale.
6. UI renders that state without converting unknown to zero.
7. Alert evaluation consumes validated metrics and applies thresholds, sample minimums, cooldown, and deduplication.
8. Exports reuse the same definitions and authorization rules.
9. Retention/deletion jobs follow documented policy and do not delete required financial/security audit records without an approved retention basis.

Instrumentation failures must be observable but non-fatal to the primary user request. Avoid double counting retries/fallbacks and distinguish logical requests from individual provider attempts. Use idempotency keys or deduplication for event delivery when necessary.

### M.6 Data contracts and metric dictionary

Phase 0 must create a metric dictionary before implementing cards. Each entry must record:
- display name and purpose;
- exact numerator/denominator or aggregation;
- authoritative table/API and actual fields;
- event inclusion/exclusion rules, including retries, refunds, cancellations and late events;
- timezone and period boundary;
- units and currency;
- freshness target and last successful source timestamp;
- actual versus estimated classification and uncertainty;
- data coverage/sample size and empty-state behavior;
- authorization/RLS boundary;
- retention, redaction, query/index considerations;
- unit, integration, database and acceptance tests.

At minimum define registered accounts, daily/weekly/monthly active users, request success rate, p50/p95 latency, timeout rate, provider attempts, input/output tokens, estimated/actual provider cost, reserved spend, settled spend, gross settled revenue, refunds/chargebacks where supported, incident counts, automation outcomes, and source freshness. Definitions must be consistent across Overview, module views, alerts, reports, and exports.

### M.7 UI component structure and visual system

Map to the existing frontend stack; do not add a framework solely for this dashboard. Suggested component responsibilities:
- responsive shell and owner navigation;
- global date range/comparison selector;
- module-specific filter bar and active-filter chips;
- KPI card with metric definition, delta, timestamp, and source state;
- time-series chart with day/week/month/year grouping;
- sortable/paginated data table or mobile stacked rows;
- source-health/freshness indicator;
- incident detail/timeline;
- export dialog and export status;
- accessible confirmation dialog for later privileged actions.

Visual direction: premium and lively without being overly colorful. Use a neutral white/soft-gray foundation, navy/charcoal text, and restrained semantic accents: blue for primary actions/activity, emerald for healthy state/revenue, violet for AI operations, amber for spend/warnings, coral/red for critical failures. Avoid rainbow dashboards, heavy gradients, saturated surfaces, and color-only status. Support system/light/dark appearance where consistent with the app. On iPhone Safari, ensure readable labels, safe-area spacing, touch-friendly controls, compact navigation, chart alternatives, and stacked/scrollable tables.

### M.8 Reliability, performance, and self-monitoring

- Each source adapter needs bounded timeouts and graceful degradation; use retries only for safe transient operations, with backoff and no retry storms.
- Show partial results and per-source failure when possible instead of failing the whole dashboard.
- Monitor dashboard API error rate, latency, query duration, rate limiting, telemetry lag, stale-source duration, aggregation failures, alert delivery, and export failures using an independent existing monitoring path where available.
- Never rely exclusively on the Owner Command Center to report that the Owner Command Center is broken.
- Establish baseline performance and expected volume during Phase 0; add indexes only after schema/query-plan review and migration tests.
- Use conservative visibility-aware refresh, manual refresh, backoff on failure, and no unbounded polling.
- Verify keyboard access, focus management, contrast, reduced motion, screen-reader labels, narrow-screen layout, and network interruption recovery.
- Set explicit service objectives and alert thresholds only after the actual source and baseline are understood; do not invent SLO values from mock data.

### M.9 Architecture and delivery artifacts

Phase 0 must produce and maintain:
1. Existing-code-to-target-architecture map.
2. Owner access-boundary diagram, including page/API/export/control paths.
3. Verified source-of-truth and metric dictionary.
4. Route/API contract list mapped to existing route conventions.
5. Data-flow and privacy/retention map.
6. Schema/migration/RLS/grant/tenant-isolation review.
7. Threat model covering route discovery, forged proxy headers, session abuse, cache leakage, CSRF, data exfiltration, export injection, denial of service, and compromised integrations.
8. Date/filter/sort matrix and metric comparison definitions.
9. Test matrix and evidence from actual runs.
10. Phased implementation plan, dependencies, owner decisions, rollout/rollback and recovery plan.

## N. Final completeness checklist and release gate

Before marking the specification or implementation complete, explicitly check every item below. Mark each as **Implemented and tested**, **Documented only**, **Blocked by source/integration**, or **Not started**; do not use a vague “done” status.

- [ ] Premium restrained multi-accent responsive UI; iPhone Safari and desktop.
- [ ] Owner navigation button appears only after server-confirmed eligibility.
- [ ] Both server-only email and trusted-IP allowlists required; fail closed when absent/invalid.
- [ ] Genuine uniform HTTP 404 for unauthorized page, APIs, exports and controls; no cache/content leakage.
- [ ] Session expiration/revocation, CSRF/origin protections, rate limits and sensitive-action controls tested.
- [ ] Overview and every module use verified real sources and display freshness/coverage/estimates.
- [ ] Shared day/week/month/year grouping; all required date presets; custom range and timezone rules.
- [ ] Previous-period comparisons with correct zero/partial/missing-data behavior.
- [ ] Module-specific filters and sortable tables; server-side allowlists and stable pagination.
- [ ] Identical filter/date/sort semantics for charts, tables, KPIs and CSV exports.
- [ ] Metric dictionary distinguishes logical requests, provider attempts, retries, estimates, actual cost and settled revenue.
- [ ] AI operations, users/growth, infrastructure/releases, security/audit, automation/jobs, finance, incidents/alerts, reports and settings.
- [ ] Alert threshold/sample/cooldown/deduplication and delivery failure/retry/resolution tested end-to-end.
- [ ] AI investigator uses cited evidence and cannot independently take privileged actions.
- [ ] Release guard shows real check source/commit/timestamp and never labels missing checks as passed.
- [ ] Emergency controls remain read-only/disabled until separately approved, implemented, reviewed and tested.
- [ ] Dashboard self-monitoring, graceful degradation, bounded queries, backup/restore and rollback plan.
- [ ] Privacy minimization, retention/deletion, legal document and version-default updates where data handling changes.
- [ ] Database RLS/grants and tenant boundaries verified; no direct browser access to privileged tables.
- [ ] Required repository checks recorded with exact outcomes; screenshots alone do not satisfy acceptance.
- [ ] PR is reviewable; no unapproved merge, production env change, production migration, or deployment.

The first implementation PR must start with Phase 0 evidence, then the owner-only security boundary and actual HTTP 404 tests. Continue only after the owner reviews and approves the Phase 0 deliverable. This specification remains documentation until code, tests, and verified data sources are delivered in reviewed implementation PRs.


## O. Appearance, interaction, and responsive design specification

This section turns the approved visual direction into concrete UI requirements. The target is a premium, calm, modern product interface: polished and lively through spacing, typography, depth, data visualization, and restrained semantic accents—not through a rainbow palette or excessive decoration.

### O.1 Overall visual language

- Use a light-first neutral foundation: white and soft-gray page surfaces, subtle section separation, navy/charcoal primary text, and muted secondary text.
- Use a restrained semantic accent palette: blue for primary actions and user activity; emerald for healthy states and verified revenue; violet for AI/model activity; amber for spend, caution, and pending states; coral/red only for critical failures or urgent risk.
- Color is purposeful and consistent. Do not assign a different bright color to every card, add gradients as decoration, or fill large areas with saturated colors. Red must not be used as a general accent.
- Use whitespace, alignment, typography, fine borders, and carefully limited shadows to create hierarchy. Prefer subtle elevation and clean surfaces over heavy shadows, glass effects, glowing edges, or ornamental gradients.
- Keep the visual system coherent with the existing NasrinAI app rather than introducing a visually unrelated admin template. Inspect existing design tokens, fonts, icons, buttons, border radii, and light/dark conventions before creating or changing them.
- Avoid emoji as the primary status or navigation icon. Use the existing icon approach where available and ensure icons have accessible names when needed.

### O.2 Page composition and hierarchy

- The overview should answer, in order: **Is the platform healthy? What changed? What needs attention? What is driving usage and cost?**
- Use a compact top bar with page title, owner context, global date range, comparison toggle, last-updated timestamp, and manual refresh.
- Use a compact, responsive navigation pattern: a clear desktop sidebar or existing app navigation convention, and a space-efficient mobile menu. Do not let the owner-only navigation appear before server-side eligibility is confirmed.
- Arrange the overview as a responsive grid: a small set of high-value KPI cards first, then trend charts and operational breakdowns, followed by incidents, source health, and recent activity. Avoid a wall of equally prominent cards.
- Group related controls and content under clear headings. Use progressive disclosure for advanced filters, detailed traces, and low-frequency controls so the default screen remains understandable.
- Establish a clear primary action only when one is appropriate. Monitoring pages should not make destructive controls visually prominent.
- Use consistent card padding, alignment, label placement, chart legends, status treatment, and empty-state layout throughout all modules.

### O.3 Typography and information density

- Use the app's existing font stack unless the repository audit establishes a reason to change it. Do not add font dependencies or remote font requests just for the dashboard.
- Make metric values easy to scan; keep labels, units, comparison deltas, and freshness visible without forcing users to open a detail view.
- Use a clear type hierarchy for page titles, section titles, card labels, values, body text, metadata, and timestamps. Avoid tiny low-contrast labels.
- Format large numbers, token counts, durations, percentages, and currency consistently. Include units and currency; use locale-aware formatting where appropriate.
- Use tabular numerals for aligned numeric comparisons if supported by the current styling approach.
- Prefer concise labels and meaningful tooltips/help text. Important definitions must remain available on mobile and must not be conveyed by color alone.

### O.4 Charts and visual data

- Choose chart types that fit the question: line/area for trends, bars for comparisons, stacked bars only when components need to be compared, and compact distribution charts only when they improve interpretation.
- Keep chart backgrounds neutral and gridlines subtle. Use consistent series colors by metric category across the application, not a new palette per chart.
- Include readable axes, units, date labels, legends, selected-period context, and accessible text summaries. Avoid 3D charts, excessive animation, decorative gauges, and misleading truncated axes.
- On narrow screens, simplify ticks and legends, allow a deliberate horizontal chart scroll only when needed, and provide a concise tabular or textual alternative for important values.
- Clearly distinguish actual, estimated, reserved, stale, and unavailable values. Use labels, icons, patterns, or text alongside color.
- Do not animate live data in a way that distracts from reading or causes motion discomfort. Respect reduced-motion preferences.

### O.5 Status, alerts, and interaction states

- Use a small, consistent set of status patterns: healthy, informational, pending, warning, critical, unavailable, stale, and unknown. Each must have a text label and, where useful, a recognizable icon.
- Critical alerts should stand out through severity label, placement, and a restrained critical color—not through flashing, constant pulsing, or oversized warning banners.
- Provide clear hover, focus, pressed, disabled, loading, success, and error states. Keyboard focus must be visible; disabled controls must explain their state where appropriate.
- Use skeletons only when they help preserve layout; otherwise use a simple loading indicator. Never display skeletons indefinitely after a source failure.
- Empty states must explain whether there is no data yet, no matching results, or an unavailable source. Offer a relevant next step only when one exists.
- Confirm filters with visible active chips or summary text; include clear/reset actions. Do not hide the current date range, sorting direction, or applied filters.
- Destructive/high-impact confirmation dialogs belong to a later, separately approved phase and must clearly state the action and recovery consequences.

### O.6 Appearance preferences

- Support **System**, **Light**, and **Dark** appearance, consistent with the existing NasrinAI appearance settings and implementation conventions.
- System mode follows the device preference. Light and Dark remain user-selected until changed. If the existing app persists preferences, use that existing mechanism; do not introduce a new storage dependency or expose sensitive information in local storage.
- Ensure all surfaces, borders, charts, form controls, popovers, tables, dialogs, focus indicators, and status colors have reviewed contrast in both themes.
- Dark mode should use layered charcoal/navy surfaces and legible muted text, not pure-black backgrounds everywhere or neon accents. Maintain the same semantic meaning for accent colors across themes, adjusting shades for contrast.
- Avoid flashing between themes during initial render where the existing app architecture can prevent it safely. Do not add inline scripts or weaken the current Content Security Policy to implement theme switching.
- Theme changes must not reset date filters, table sorting, current navigation, or other active dashboard state.

### O.7 Responsive and mobile-first behavior

- Treat iPhone Safari as a first-class supported environment, not a final polish task. Test real narrow viewports, safe areas, browser zoom, orientation changes, and on-screen keyboard behavior.
- At small widths, collapse secondary navigation, stack KPI cards, wrap or collapse filters into an accessible panel, and convert dense tables to stacked records or a deliberate scroll region.
- Never allow global date controls, active filter chips, tables, charts, or dialogs to create accidental page-wide horizontal overflow.
- Make interactive targets comfortable for touch and provide sufficient spacing between adjacent controls. Do not rely on hover to reveal essential information or actions.
- Ensure date pickers, sort menus, tooltips, confirmation dialogs, and dropdowns remain visible and usable near screen edges and when the keyboard is open.
- Keep refresh, current range, source freshness, and critical alert status easy to find without forcing excessive scrolling.
- Test desktop, tablet, and mobile breakpoints against actual layout behavior rather than relying on device names alone.

### O.8 Accessibility and localization

- Target WCAG 2.2 AA contrast and interaction requirements to the extent applicable to the existing product and test setup.
- Support keyboard navigation, semantic headings, meaningful accessible names, focus management, screen-reader announcements for important updates, and reduced motion.
- Do not rely on color, position, hover, or chart shape alone to communicate status.
- Format dates and numbers consistently with the selected range and documented Asia/Manila business-time interpretation; label the timezone when ambiguity is possible.
- Ensure long identifiers, provider/model names, errors, and translated labels wrap or truncate safely without hiding the full value from assistive technology.
- Avoid auto-refresh behavior that repeatedly steals focus or announces every metric change to screen readers.

### O.9 Visual acceptance checklist

- [ ] Looks premium and lively without looking overly colorful or monochrome.
- [ ] Neutral light foundation, restrained semantic accent palette, consistent typography and spacing.
- [ ] Clear overview hierarchy; high-value KPIs first; details progressively disclosed.
- [ ] Charts are legible, accurately scaled, labeled, and consistent across modules.
- [ ] Light, dark, and system modes work across all components and preserve current UI state.
- [ ] Loading, error, empty, stale, unavailable, disabled, focus, and success states are designed.
- [ ] Mobile navigation, filters, date selection, charts, tables, and dialogs work on iPhone Safari.
- [ ] Keyboard, screen-reader, contrast, touch-target, and reduced-motion behavior is tested.
- [ ] No fake live-data appearance, excessive animation, unnecessary gradients, or status communicated by color alone.
- [ ] No new runtime dependency or CSP weakening was introduced for appearance features.

Appearance acceptance is part of functional acceptance: do not mark the dashboard complete based on a desktop screenshot alone. Test real data states, interaction states, both themes, responsive behavior, and accessibility. The visual specification does not authorize implementation, merge, or deployment by itself.


## P. Phase 0 findings and implementation sequencing (2026-10-14)

The initial repository inspection is recorded in `docs/owner-command-center-audit.md`. This section is authoritative for the first implementation milestone and supplements Sections 14, 15, 16, 17, and M.

### P.1 Verified current-state findings

- The current HTTP application handles `/healthz`, routes `/v1/*` through its API router/gateway, serves public static files, and returns a real 404 for unmatched routes.
- The static file server serves files from `public/`; the owner dashboard must not be a public static page protected only by hiding a link.
- The existing Supabase refresh cookie is HttpOnly and scoped to `Path=/v1/auth`. The browser's access token is held in memory and sent as a bearer token for API requests. Therefore, a direct browser navigation to `/owner` cannot be authorized using the existing refresh cookie alone.
- The app already has a trusted-proxy-aware client IP helper configured through `TRUST_PROXY_HOPS`; owner authorization must use the same trusted resolver, not parse arbitrary forwarding headers itself.
- Existing code and migrations establish server-side identity verification and server-only Supabase table boundaries. Those must be reused and preserved.
- The dashboard itself, owner route, owner API, allowlist configuration, and owner-session flow are not considered implemented until code and regression tests demonstrate them.

### P.2 Mandatory owner-session bootstrap design

A secure direct-page route requires an explicit bridge from the existing bearer-token sign-in flow to a narrowly scoped owner session. Before serving any dashboard HTML:

1. The signed-in application submits a same-origin owner-session bootstrap request authenticated with its current bearer access token.
2. The server validates the token through the existing Supabase Auth verifier, obtains the verified identity, validates the server-only `OWNER_ALLOWED_EMAILS` and `OWNER_ALLOWED_IPS` configuration, and checks both the verified email and trusted client IP.
3. Only after both checks pass may the server set a dedicated Secure, HttpOnly, SameSite=Strict, short-lived owner-session cookie. Never put credentials in a URL, browser-readable storage, HTML, or logs; do not reuse the refresh token cookie as the owner session.
4. Scope the cookie to the owner route/API path if the selected route layout permits it. The exact token representation, cookie scope, expiration, secret/key requirements, and revocation semantics must be implemented and tested—not guessed to avoid configuration work.
5. The owner page and every owner API, export, and future control endpoint independently validate the owner session, re-check current allowlist configuration and trusted IP, and fail closed.
6. Every unauthorized owner page/API/export/control request receives the same generic real HTTP 404. No owner content may be sent before authorization. Missing/invalid configuration, unverified identity, or unknown trusted IP must deny access.
7. The session must have a short documented lifetime and safe sign-out/expiration behavior. Tests must cover expired and revoked Supabase sessions, account changes, IP changes, forged headers, and session replay boundaries.

If this bridge cannot be implemented without weakening the existing authentication design, stop and report the blocker. Do not substitute a frontend-only guard, trust the browser's email, rely on a hidden URL, or change the required 404 behavior.

### P.3 Implementation gate

Phase 0 audit findings and the source-of-truth matrix live in `docs/owner-command-center-audit.md`. Implementation remains on `feature/owner-command-center` in PR #353 so the owner can review all phases in one PR. Before the first dashboard metrics are added, implement and test the owner-session bootstrap and uniform 404 boundary. Then proceed to the read-only dashboard using verified data sources. Update the audit matrix as sources are confirmed and keep unavailable integrations visibly unavailable.

This update records verified source observations and a required design; it does not claim that owner authentication, routes, metrics, or tests have been implemented or run.
---

## Q. LLM provider consumption, token accounting, and remaining credits (owner request: 2026-10-15)

**Status:** required design addition; documentation only until runtime code, data sources, tests, and an authorized preview prove it works. This section supplements the existing Finance/Costs and AI Operations modules. It does not claim the dashboard or provider balance integrations are live.

### Q.1 Owner outcome

The owner must be able to answer, for every configured LLM provider and exact model: **how much has been used, how many input/output tokens were consumed, what did it cost, what balance or credits remain, where did each number come from, and when was it last verified?**

The UI must present separate, independently filterable sections for:

1. **OpenAI** — each exact OpenAI model, token usage, requests/attempts, cost, credit/balance information, and freshness.
2. **Google Gemini** — each exact Gemini model, token usage, requests/attempts, cost, available credit/balance/quota information, and freshness.
3. **Anthropic Claude** — each exact Claude model, token usage, requests/attempts, cost, available credit/balance information, and freshness.
4. **Other/free-pool providers** — a separate record per provider and model, with the same fields where the provider exposes reliable data.
5. **All providers** — aggregate overview with filters and drill-down. The all-provider total must not obscure the separate provider views.

Provider brands must not be conflated. OpenAI, Google/Gemini, and Anthropic/Claude are separate accounts, billing sources, credentials, balances, price schedules, and reconciliation domains. Do not merge their balances or show one combined “AI credit” number unless it is clearly labelled as a calculated sum with currency conversion and complete provenance.

### Q.2 Required metrics and dimensions

Each provider/model record should include the following fields where available:

| Field | Required meaning |
|---|---|
| Provider and model | Canonical provider ID and exact model ID, not a display alias alone |
| Time range | Day, week, month, year, and custom range; define timezone and interval boundaries |
| Requests | Logical user requests, successful answers, failed attempts, retries, and fallback attempts as distinct counts |
| Input tokens | Provider-reported input tokens; estimated values must be separately labelled |
| Output tokens | Provider-reported output tokens; estimated values must be separately labelled |
| Other token classes | Cached input, reasoning, audio/image or other usage classes only where the source returns a reliable count |
| Total tokens | Sum only compatible, non-overlapping token categories; document the calculation |
| Cost | Actual provider-reported charge when available, otherwise a clearly labelled estimate from a versioned price source |
| Currency | Currency and any conversion source/date if converted |
| Free quota | Verified quota used/remaining and reset time only when the provider exposes it or its documented rules permit a valid calculation |
| Remaining credits/balance | Provider-reported or owner-verified balance snapshot, never guessed from token consumption |
| Source | Official API, provider billing export, owner-entered console snapshot, internal estimate, or unavailable |
| Freshness | Last successful retrieval/verification time, stale threshold, and source coverage |
| Status | Healthy, low balance, stale, unavailable, quota exhausted, billing warning, or telemetry incomplete |
| Provenance | Pricing version, API/source version, calculation time, and any reconciliation/correction reference |

Use Asia/Manila as the dashboard's default display timezone, consistent with the product, while retaining source timestamps in UTC and displaying the timezone in custom ranges and exports. Do not silently convert provider billing periods or reset boundaries to Manila time when the provider defines them differently.

### Q.3 Token and cost accounting rules

- Inspect the current `usage_events`, spend-reservation, provider adapter, and billing implementations before proposing or creating a competing ledger. Reuse a source only after verifying its schema and writer semantics.
- Record one logical request separately from every provider attempt. A request that tries Provider A, receives a quota error, then succeeds through Provider B is one user request and at least two provider attempts. Report both correctly.
- Failed attempts may incur provider charges; count their reported usage/cost when supplied. Do not assume a failed request was free.
- Preserve provider-reported token counts as authoritative for that response when available. If usage is absent, mark it missing or estimate it explicitly; do not silently substitute a guessed number.
- Use a versioned pricing table and record which price revision produced each estimate. When actual provider-reported cost later becomes available, keep both values and show reconciliation rather than adding the estimate and actual together.
- An exact model may be labelled zero-cost only when its free status is explicitly verified for the configured provider/account/quota. Otherwise cost is **unknown**, not $0. A zero-dollar estimate must not conceal paid fallback attempts or charges incurred by a provider.
- Show provider cost and internal estimated cost as different concepts. Do not equate tokens multiplied by a public list price with the exact charge on an account that has discounts, prepaid credits, taxes, negotiated rates, cached-token rates, or free quotas.
- Use integer minor units or safe decimal arithmetic for money; never use imprecise floating-point aggregation as the source of truth for financial totals.
- Preserve source records and audit adjustments/reconciliation. Never rewrite historic usage silently when a provider changes a price or an estimate is corrected.
- If the current schema does not support these semantics, propose a reviewed additive migration with server-only access and tests. Never loosen RLS, grants, or tenant isolation to make dashboard queries easier.

### Q.4 Provider credit/balance accounting

For **OpenAI, Gemini/Google, and Anthropic/Claude**, the UI must independently show the remaining credit/balance or an explicit unavailable state. Implementation must first establish what each official provider source actually exposes for the configured account. Do not assume that every provider offers a public API for prepaid credits or remaining balance.

For each balance record:

- Value and currency, if verified.
- Balance type: prepaid credit, available account balance, billing credit, invoice amount due, spending limit, or another provider-defined metric. These concepts must not be conflated.
- Source and retrieval method; whether it is official API data, a provider-console figure manually verified by the owner, or unavailable.
- Timestamp last fetched/verified, source billing period if applicable, and freshness status.
- Optional owner-maintained snapshot: amount, currency, date/time, source reference/note, and who entered/verified it. Preserve history and audit changes.
- Error or unavailable reason suitable for the owner, with secret details removed.
- Threshold configuration and alert history for low credit, stale data, or failed balance retrieval.

**Never** invent a balance, hardcode a production balance, scrape authenticated provider consoles without an approved supported integration, store provider-console passwords/session cookies, infer a live credit balance by subtracting internal estimates from an initial number, or display stale data as real-time. If no trustworthy source is connected, display **Unavailable — provider balance source not connected** (or the exact honest reason). The dashboard must still show available usage/cost data independently.

### Q.5 UI, filtering, and reporting

- Add a dedicated **AI Finance / Provider Usage** subview under the owner dashboard's AI Operations or Finance area, aligned with existing navigation rather than creating a competing dashboard.
- Show separate OpenAI, Gemini, and Claude provider cards with total tokens, cost, remaining balance/credits, data freshness, and status. Clicking a card filters the model table to that provider.
- Provide a model-level table with provider, exact model ID, input/output/total tokens, requests, failed attempts, fallback count, actual cost, estimated cost, balance/credit status, last update, and source status.
- Include date filters for day, week, month, year, and custom ranges; sorting by provider, model, tokens, cost, requests, status, and balance freshness; filtering by tier, feature, provider, model, outcome, and estimate/actual status.
- Add charts for token consumption and cost trends, with compatible units, explicit axes, and no misleading stacked totals across incompatible token categories or currencies.
- Provide a request/attempt drill-down with timestamps, model/provider, usage, cost provenance, status, fallback chain, and safe provider request ID. Do not show raw prompts, attachments, API keys, auth headers, or private user content.
- Export CSV/report data with the same filters, units, currency, timezone, provider/model separation, source timestamps, and estimated/actual labels as the UI.
- Support loading, empty, stale, partially unavailable, provider error, and no-permission states. Do not render zero as a placeholder for missing data.
- Refresh on demand and/or on a bounded cadence. Display the last successful refresh and never let background refresh overwrite the selected time range, filters, sort, or navigation state.
- Follow the existing premium restrained design, accessible chart/table behavior, and mobile Safari requirements. Dense model tables must remain usable on iPhone without global horizontal overflow.

### Q.6 Alerts and cost guardrails

- Configurable alerts for provider/model quota approaching exhaustion, quota exhaustion, low or stale credit balance, unexpected cost/token spikes, missing usage events, repeated fallback, provider billing/price changes, and source retrieval failures.
- Each alert includes threshold/unit, scope, severity, trigger time, source evidence, current state, last notification, and resolution time. Use deduplication, cooldown, and explicit recovery/resolution transitions.
- Do not hardcode business thresholds or default provider credit balances into application code. Configuration and defaults must be documented and safely validated.
- Keep provider quota alerts separate from NasrinAI plan token limits and hourly abuse controls. A third-party provider quota reset must not reset a user's NasrinAI allowance or weaken anti-abuse limits.
- Preserve existing tier ceilings, capability/privacy checks, and budget reservations. An alert does not authorize paid fallback, provider credit purchase, or account-setting changes.

### Q.7 Security and source-of-truth requirements

- All provider telemetry and credit data must be fetched and aggregated server-side using authorized credentials. Secrets stay in Vercel/server-side secret storage and never enter browser-facing config.
- The Owner Command Center page, API, filters, exports, and any future controls must enforce the specification's owner-session, email/IP allowlists, and uniform unauthorized HTTP 404 boundary. Client-side hiding is not authorization.
- Preserve Supabase RLS, server-only grants, tenant boundaries, and least privilege. Do not expose one user's prompts or attachments through usage drill-downs.
- Use official documented provider APIs, exports, or explicitly verified owner-entered snapshots. Record data coverage, freshness, currency, source, and confidence. Unconnected sources must be shown as unavailable.
- Provider APIs can have separate permissions, pagination, rate limits, and billing semantics. Handle partial results, pagination, timeouts, rate limits, stale responses, and provider outages; do not mark partial results complete.
- Any new telemetry collection or retention must follow existing retention/privacy policy and trigger legal-document updates where needed.

### Q.8 Implementation sequence and acceptance

1. **Source/schema audit:** inspect migrations and writers for usage, spend reservations, provider attempts, pricing, and billing. Publish a field/source mapping and identify gaps before changing schema.
2. **Server-side ledger:** add missing per-request/per-attempt token and cost fields with source provenance, deduplication, safe decimal handling, and tenant/server-only protections.
3. **Provider telemetry:** implement official usage/billing source integrations only where supported and authorized. Document each provider's actual fields and limitations.
4. **Credit source integration:** independently assess OpenAI, Gemini/Google, and Anthropic/Claude balance/credit sources. Implement supported official retrieval or owner-verified snapshots; show unavailable otherwise.
5. **Quota-aware free-provider routing:** when one provider reaches its free quota, temporarily cool down that provider/model and continue to other eligible candidates without exceeding limits; recover after verified reset. Keep tier/privacy/safety/budget rules unchanged.
6. **Owner APIs and authorization:** expose only server-aggregated fields through owner-protected APIs; enforce the same authorization on exports and drill-downs.
7. **Premium responsive UI:** separate provider cards, model table, charts, filters, refresh/freshness, alerts, empty/error states, and mobile-safe drill-downs.
8. **Tests:** test provider/model separation; token totals; logical request versus attempt totals; fallback and quota reset; paid versus free classification; unknown cost; estimate/actual reconciliation; balance freshness/manual snapshots; missing source behavior; export parity; owner 404 and tenant isolation; and no secret leakage.
9. **Verification:** run focused tests, full `npm test`, `npm run check:secrets`, database tests and other required CI; inspect the full diff and a working Vercel preview on desktop and iPhone. Do not claim live account connectivity based only on mocks/unit tests.

**Acceptance gates:**
- The dashboard displays source-backed token and cost totals per provider and exact model, with estimates distinguished from actual charges.
- OpenAI, Gemini, and Claude remain separate, each with its own credit/balance state and timestamp.
- Unavailable or stale balances are labelled honestly; no placeholder zero or invented live balance appears.
- Free-provider quota exhaustion triggers safe fallback and reset-aware recovery without bypassing quotas or stopping the whole eligible pool.
- Every aggregate can be traced to its source and calculation; attempts are not double-counted as logical requests.
- Owner-only access, server-side authorization, tenant isolation, privacy, and secret safety pass regression tests.

### Q.9 Progress record (2026-10-15)

- Owner Command Center blueprint remains in PR [#353](https://github.com/primusco20/nasrinAI/pull/353), branch `feature/owner-command-center`; it is documentation-only and open/unmerged at the time of this update.
- Free LLM provider pool work is in PR [#361](https://github.com/primusco20/nasrinAI/pull/361), branch `feat/free-llm-provider-pool`; it is open/unmerged at the time of this update.
- PR #361 previously reported 655 passing tests and passing secret scan, dependency audit, and database tests. Those checks must run again against new commits; no result is claimed for this new plan.
- Provider adapter/catalogue foundations are present in PR #361. Full quota-aware failover/reset handling, live usage/billing integrations, real provider credit balances, model-by-model dashboard aggregation, and live end-to-end verification remain **not implemented or not verified** until evidence is recorded.
- No provider keys, credits, production environment variables, schema changes, merge, or deployment were performed by this documentation update.
- The implementation must keep the same owner-command-center branch/PR for the Owner Command Center work unless the owner explicitly changes that workflow. Update this section, `docs/owner-command-center-audit.md`, and `docs/pr-change-log.md` as each source, implementation phase, and test result changes status.

