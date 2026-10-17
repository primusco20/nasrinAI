# NasrinAI Master Plan Summary for Claude

**Purpose:** This is the durable handoff and memory index for Claude Code and future contributors working on NasrinAI. Read this file before planning or implementing changes, then read the linked source-of-truth documents relevant to the task.

**Status rule:** This file summarizes plans; it does not prove implementation. Always distinguish **planned**, **documented**, **in development**, **merged**, **deployed**, and **verified in production**. Never report a feature as shipped without checking code, tests, GitHub PR state, configuration, and live behavior where applicable.

**Last updated:** 2026-10-17

## 1. Required continuity rule

Whenever a NasrinAI plan, upgrade, architecture, feature set, implementation phase, or significant decision is created or changed:

1. Update the relevant detailed plan document.
2. Update this file, `docs/CLAUDE_MASTER_PLAN_SUMMARY.md`, with a concise entry, status, dependencies, and links to the detailed source of truth.
3. Record important decisions, exclusions, blockers, PR/branch references, test evidence, and owner actions. Do not rely on chat history alone.
4. Keep historical facts separate from current verified status. If current status has not been checked, label it **needs verification**.
5. Prefer a feature branch and reviewable PR; do not commit directly to `main`, merge, or deploy unless the owner explicitly authorizes that action and repository policy permits it.
6. Before implementing, inspect the current repository, existing code/schema/docs/tests and open PRs. Avoid duplicate documents, tables, routes, adapters, or conflicting implementations.
7. After implementation, update the detailed document and this summary with exact files, migrations, tests run/results, PR link, deployment status, known gaps, and next step.
8. Do not stop after documentation when the approved task requires implementation. Do not claim success without verified evidence.
9. Preserve the project's security requirements, tenant isolation, RLS, authentication/authorization, privacy and consent rules, plan limits, provider policy, compatibility and existing contracts. Never expose credentials or private infrastructure details.

## 2. Product and naming

- **NasrinAI** is the main AI workforce platform.
- **Quick, Pro, Max, Ultra** are the four AI intelligence/subscription tiers. Keep limits configurable as specified by the active plan documents; do not silently hardcode production quotas.
- **NCC means Nasrin Client Connect** and is the CRM, client-management, and workflow-automation product at `ncc.nasrinai.com`.
- **NasrinAI Connect** is a separate product for authorized website/widget integrations. Do not rename NCC to “NasrinAI Control Center.”
- **NCC Automation Studio** is the workflow builder within Nasrin Client Connect.
- **NCC AI Voice Front Desk** is a planned NCC module for inbound customer calls and authorized outbound calls. It is not the same as NasrinAI Connect.
- **Gallery:** `gallery.nasrinai.com`, premium monochrome/minimal motion and animation library with restrained orange accents.
- **NN:** `nn.nasrinai.com`, separate noise-canceling, transcription, meeting-notes and related productivity app.

## 3. Major plan index

Treat the detailed files and actual repository code as the source of truth. File names below should be verified before editing; do not invent a path if it is absent.

| Initiative | Goal / scope | Status rule / next check |
|---|---|---|
| AI orchestration and professional workforce | Detect intent/complexity/profession, select authorized tools and suitable model/provider, consider latency, context, privacy, plan and cost; support Quick/Pro/Max/Ultra | Audit current routing and adapters before claiming coverage |
| Research and education | Stronger web research; relevant sources and clickable citations; target 10 distinct resources for research/study requests when appropriate | Verify source retrieval, citation quality and intent handling |
| Provider pool and quota resilience | Multiple eligible model providers, provider allowlist, quota/error classification, safe fallback, cooldowns and reset recovery | A provider catalog alone does not prove working runtime adapters |
| AI capability awareness and conversation storage | Agent knows actual available capabilities without exposing private internal stack/resources; persist replies only under approved filtering/access/privacy rules | Verify implementation, retention, RLS and secret redaction |
| Autonomous coding / repository assistance | Inspect code, identify issues, propose/fix changes, run tests and report evidence; do not falsely claim merge/deploy/rollback | Use branch/PR review process; protect secrets and production |
| NCC CRM and workflow automation | Contacts, deals, tasks, activities, workflow builder, triggers, logic, connectors, approval outbox, execution queue/workers, logs, retries and analytics | See `docs/ncc.md` and `docs/ncc-upgrade.md`; audit current code and PRs |
| NCC AI Voice Front Desk (planned) | AI disclosure; inbound call answering; approved knowledge; lead capture; verified appointment/CRM actions; human transfer; authorized outbound callbacks/campaigns; consent, suppression, costs, recording/privacy controls | Not shipped until a real telephony adapter, compatible media runtime, verified credentials/webhooks and end-to-end tests exist |
| NCC social, lead and sales automation | Supported official social APIs, approval-first outbound messages/posts, scheduled publishing, lead response/qualification, follow-up workflows, consent/opt-out and CRM analytics | Validate each provider/channel capability; never promise universal integration or universal 1 GB uploads |
| NCC automation runtime | Separate control plane from durable execution plane; scheduler, durable queue/workers, typed nodes, versioned workflows, retries/checkpoints/cancellation, policy checks | Do not assume Vercel request handlers are persistent workers; select runtime after testing |
| Performance and reliability | Images/lazy loading, code splitting, cache, API payload optimization, SQL/index/pagination/render improvements, loading states, CDN and Lighthouse measurements | Benchmark before/after; avoid unjustified infrastructure such as load balancers |
| Motion gallery | Reusable animation/motion patterns; premium minimalist monochrome design with restrained orange | Verify the gallery spec and implementation status |
| NN noise-canceling app | Local AI noise cancellation with native fallback, cloud transcription/summaries, storage choice, notes/meetings/chat/calendar and supported integrations | Verify actual OAuth scopes, API availability and feature implementation |
| npm to pnpm migration | Consistent package manager, lockfile, scripts, CI and deployment workflow | Inspect current package files and open PRs; don't mix package managers |
| Security, privacy and database quality | Server-side authorization, RLS/tenant isolation, secret management, consent, retention/export/deletion, migrations and audit logs | Re-run relevant tests after later schema or routing changes |
| Premium UI and voice UX | Accessible responsive UI, refined dark/light appearance, restrained color, established voice-control layout preferences | Check existing design system before introducing new styling |

## 4. NCC AI Voice Front Desk requirements to preserve

This is a **planned capability** until verified in code and staging.

### Inbound
- Answer calls on a verified, connected business number; clearly disclose the AI identity.
- Use approved business knowledge; do not invent pricing, policies, availability or promises.
- Capture and qualify leads with approved, non-sensitive fields.
- Look up CRM data only with proper caller verification before disclosing account-specific details.
- Book, change or cancel appointments only through a real connected scheduling API, after confirming details.
- Transfer/escalate when asked, when confidence is low, or for complaints, sensitive/high-impact matters, repeated failures, or unsupported requests.
- Provide business-hours, after-hours, voicemail/human fallback and provider-outage behavior.
- Record the verified call outcome and permitted summary in the CRM timeline.

### Outbound
- Support legitimate, authorized callbacks, appointment reminders, service notifications and eligible lead follow-ups.
- Default outbound calling/campaigns to disabled until provider setup, jurisdiction rules, consent/suppression and explicit per-workflow authorization are configured.
- Enforce do-not-call/suppression, opt-out, local calling hours, retry limits, rate/concurrency/cost budgets and an emergency stop.
- Identify the business and AI agent; never spoof caller ID, impersonate a person or retry indefinitely.
- Preview audience and expected volume; require explicit launch confirmation for campaigns.
- Reconcile uncertain provider outcomes before retrying to avoid duplicate calls.

### Architecture, privacy and done criteria
- Use provider adapters for telephony, call control, media streaming, speech recognition/synthesis and optional real-time voice models.
- Verify regional/Philippine number support if needed, transfer, webhooks, recording controls, costs, concurrency and a compatible long-lived media runtime. Do not assume standard Vercel functions can host persistent real-time media streams.
- Authenticate provider webhooks and prevent replay; keep credentials server-side; isolate sessions and tenants.
- Recording/transcription must be separately configured with appropriate notice/consent, retention, access controls, deletion/export and redaction. Do not train on calls by default.
- Use staged delivery: provider/architecture validation and mocked harness; inbound pilot with human fallback; authorized outbound callbacks; broader campaigns only after policy/legal review and owner approval.
- Required tests include consent/opt-out, caller verification, webhook signatures, duplicate events, tenant isolation, transfer/fallback, provider outage, retry behavior, spend limits and privacy lifecycle.
- Never report it as production-ready until end-to-end staging evidence exists.

## 5. NCC architecture and safety rules

- NCC is a CRM/workflow product, separate from NasrinAI Connect.
- Access is intended to be account-allowlisted and off by default as defined in NCC source docs. Verify current configuration; do not expose owner/private controls.
- Preserve existing CRM data, Meta integration contracts, tenant checks, approval outbox, and the zero-runtime-dependency rule unless an explicit owner-approved architecture decision changes it.
- The workflow editor uses registered typed nodes and immutable published versions. AI can propose workflows but cannot grant itself permissions or bypass policies.
- Use durable execution, idempotency, bounded retries/backoff, cancellation and reconciliation for external side effects.
- External messages, publishing, destructive/financial actions and permission changes require approval or a narrow explicit authorization.
- Keep secrets out of prompts, workflow JSON, browser state, logs, screenshots and Git.
- Treat webhooks, connector outputs, imported data and model output as untrusted.
- Do not claim an integration, event source, analytics event or provider action works until its adapter and tests verify it.
- Audit existing schema before migrations. Reuse existing tables such as NCC contacts/deals/tasks/activities/automations/channels/outbox where appropriate; do not blindly create duplicates.
- Large media belongs in secure object storage with direct/resumable uploads where supported, not in database rows or oversized Vercel request bodies. Claim 1 GB support only for a fully verified compatible path and platform API.

## 6. Subscription and usage policy reminders

The most recently recorded values from prior planning discussions were:
- Quick: configured free-tier limits.
- Pro: 1M tokens per allowance, with fallback to Quick after allowance as previously specified.
- Max: 5M tokens/week.
- Ultra: 10M tokens/week.
- Earlier plans included image-generation limits and Ultra-only video up to one minute.

These are historical plan notes, **not verified live configuration**. Check the active source-of-truth config and owner requirements before changing or advertising limits. Production token limits should be set through the intended Vercel environment variables/configuration, not duplicated as hardcoded values. Keep hourly anti-abuse limits separate from token allowances; count input and output usage as defined by the active policy.

## 7. Recorded historical repository notes — verify before relying on them

These references came from earlier discussions and may have changed:
- NCC upgrade architecture was discussed in `docs/ncc-upgrade.md`, branch `feature/ncc-upgrade-architecture`, with PR #352 referenced for documentation.
- NCC implementation work was associated with PR #353.
- A performance handoff document was previously reported in `docs/performance-optimization-handoff.md`, PR #363, open/unmerged at that time.
- Free LLM provider-pool work was reported in PR #361.
- Recent discussions referenced PRs #360 and #362 for weekly token configuration, conflicts and failed tests.
- Earlier QA reported 37/37 RLS checks passing and a 405-test suite passing; other historical test counts also existed. Never use these old numbers as proof that current HEAD passes.
- Historical branch/PR state, file presence, test results and deployment status must be checked live before continuing work.

## 8. Required implementation report format

For every meaningful task, conclude the relevant detailed plan and this summary with:

- **Scope completed:** what was actually changed.
- **Files changed:** exact repository paths.
- **Database/config changes:** migrations and environment variables, without secret values.
- **Tests run:** exact commands and pass/fail counts, plus skipped tests.
- **Security/privacy checks:** relevant results.
- **Git status:** branch and PR URL/state; never claim merged unless verified.
- **Deployment status:** not deployed / preview tested / production deployed / production behavior verified.
- **Known gaps and blockers:** explicit, not hidden.
- **Next step and owner action:** what is needed to proceed.

## 9. Current task tracking

Keep this section current when new work begins or finishes. Do not invent status; use **needs verification** when unsure.

| Workstream | Current recorded status | Next action |
|---|---|---|
| NCC master architecture | Detailed plan exists in recorded work; current branch/PR state needs verification | Inspect `docs/ncc.md`, `docs/ncc-upgrade.md`, implementation and PR state |
| AI Voice Front Desk | Newly specified in this summary; detailed source document update still required unless verified otherwise | Add full specification to NCC upgrade source document, then stage implementation phases |
| Free LLM pool | PR #361 historically reported open/unmerged | Check current PR, tests and runtime adapters |
| Weekly token limit fix | PR #362 historically had conflict/config naming/test concerns | Check current branch, conflicts, CI and environment-variable contract |
| Performance handoff | PR #363 historically reported open/unmerged | Check current PR and actual implementation status |
| Gallery and NN | Plans exist in prior project discussions | Locate current specs and record branch/PR/implementation status |
| Master plan summary | This file is the continuity index | Update on every meaningful plan or implementation change |

**Claude's first action:** inspect the repository and open PRs; reconcile this summary with actual source-of-truth files and current code. If anything conflicts, preserve current verified code/security contracts, explain the discrepancy, and update the documents rather than blindly following stale notes.


## 10. Mandatory Vercel configuration rule — all plans and implementation work

**Owner requirement recorded 2026-10-17:** do not hardcode deployment configuration or use embedded defaults as a substitute for configured environment values. All environment-specific settings and secrets must be configured in the appropriate Vercel project's Environment Variables for the intended environment (Production, Preview, Development, as applicable).

- Never hardcode API keys, provider credentials, database credentials, auth/signing secrets, provider/account IDs, quota limits, model/provider selections, origins, owner allowlists, feature flags, voice settings, concurrency/cost caps or other deployment-specific policy.
- Do not silently fall back when required configuration is missing/invalid. Validate server-side and fail closed with a clear, non-sensitive diagnostic.
- Keep secrets server-only and out of client bundles, public environment-variable prefixes, prompts, workflow JSON, logs, tests and Git.
- Maintain a central configuration schema/validation layer and an inventory documenting variable names, purpose, environment scope, secrecy, validation and required/optional behavior. Do not invent values or claim the owner configured a variable without checking.
- Vercel is the deployment configuration source of truth. Runtime business data (CRM, workflow definitions, call history, executions, consent records and media) belongs in the authorized database/object storage—not environment variables.
- A placeholder-only `.env.example` may document variable names; it must contain no real secrets. Local development values, when needed, are not a production source of truth and must not be committed.
- Check the existing environment-variable contract before adding names; avoid duplicate or competing variables. Verify the correct Vercel project/environment and redeploy as needed before claiming runtime configuration is active.
- Tests must cover missing, malformed and valid required configuration; secret scans must pass. Public non-secret browser configuration is allowed only when deliberately designed as public and protected by server-side authorization as appropriate.
- For every future plan or upgrade, update the detailed source document and this summary. Include the variable-name inventory and owner actions when relevant; never ask the owner to paste secrets into chat.

## 11. AI Agents Front Desk — NCC (Nasrin Client Connect)

Detailed specification added to `docs/ncc-upgrade.md` under sections 20 and 21 on branch `feature/ncc-upgrade-architecture` (commit `ef680cd3790fa58fcb89428c8f08e0903a045452`). This work is documentation/specification only; it is not a working telephony implementation.

The feature belongs inside **NCC = Nasrin Client Connect**, not NasrinAI Connect. It includes:

- Inbound calls: AI identity disclosure, approved knowledge, lead capture, caller verification, verified CRM/scheduling actions, human transfer and safe fallback.
- Outbound/scheduled callbacks: customer-requested callbacks, appointment reminders and authorized follow-ups; durable scheduling, reschedule/cancel, timezone handling, bounded attempts and delivery reconciliation.
- Strict outbound policy: disabled by default until the provider/number/configuration is verified and the exact workflow is authorized; enforce consent/legal basis, suppression/do-not-call, opt-outs, local calling hours, attempt/concurrency/cost budgets and emergency stop.
- Provider-neutral telephony/media/speech adapter; verify regional phone availability, transfer, webhooks, cost and compatible real-time media runtime. Do not assume Vercel functions support persistent audio streams.
- Recording/transcription are separately opt-in/configured subject to notice/consent, retention, access, export/deletion and legal/privacy review. Do not use call data for model training by default.
- NCC dashboard: front-desk setup, agent behavior, call inbox, callback scheduler, outbound controls, call details, CRM timeline and deterministic analytics.
- Staged implementation: architecture/provider audit → mock harness → inbound pilot → requested/scheduled callbacks → narrowly authorized outbound expansion → production hardening.
- Fail closed on missing Vercel configuration; never simulate successful calls or claim production readiness before end-to-end staging evidence.

**Next step:** review and merge the documentation PRs through the normal process, then have Claude inspect the actual NCC code, Vercel project configuration contract, current provider capabilities, legal/privacy docs and open PRs before implementing the first approved phase. No provider is selected and no telephony credentials are assumed configured.
