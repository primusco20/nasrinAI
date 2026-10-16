# NCC Upgrade — NasrinAI Control Center Architecture

**Repository:** `primusco20/nasrinAI`  
**Product:** NCC (Nasrin Client Connect), at `ncc.nasrinai.com`  
**Document status:** Architecture and implementation plan; not a claim that every capability described here is already implemented.  
**Last updated:** 2026-10-17

## 1. Purpose and product boundary

NCC is NasrinAI's enterprise CRM and workflow-automation application. It combines contact and deal management with a programmable automation layer inspired by n8n: visual workflows, event and schedule triggers, branching logic, API integrations, AI-assisted planning, reliable execution, diagnostics, and controlled outbound actions.

NCC is **separate from NasrinAI Connect**. Connect governs authorized website/widget installation; NCC is the business CRM and automation workspace. NCC remains team-enabled and off by default. Access is allowed only when `NCC_ENABLED=true` and the verified sign-in email is included in `NCC_ACCOUNTS`. The product is enterprise-led, not open self-service, until the owner changes that decision.

This document extends the current implementation documented in `docs/ncc.md`; it does not replace that source of truth. Preserve existing CRM behavior, Meta integration contracts, tenant checks, approval outbox, and the repository's zero-runtime-dependency rule.

## 2. Architecture principles

1. **Goal-oriented automation:** users may build workflows visually or describe a goal in natural language. AI proposes a validated workflow; it does not gain authority merely by reasoning.
2. **Control plane / execution plane separation:** workflow design, versioning and authorization are separate from durable background execution.
3. **Deterministic first:** use ordinary code and rules for known transformations. Call an AI model only where interpretation, generation or reasoning is useful.
4. **Fail closed:** missing configuration, unsupported capabilities, invalid permissions or unavailable required services must produce a clear failure—not a fake success or silent skip.
5. **Tenant isolation:** every request and database operation is scoped to the authenticated account and tenant on the server.
6. **Approval for side effects:** outward actions require explicit confirmation or a narrow, owner-enabled permission for that exact action and workflow.
7. **Durable and observable:** executions, node results, retries, approval states and outbound delivery outcomes must survive process restarts and be inspectable.
8. **No secrets in model context or logs:** AI sees only the minimum sanitized information needed to perform its task.
9. **Small, reviewable increments:** stage changes first, preserve tests and avoid unrelated modifications.
10. **No new runtime packages (ADR-002):** Node.js 22 built-ins only, except the existing on-demand coding sandbox's two pinned packages. Any proposed dependency exception requires a separate owner decision.

## 3. High-level system

```text
NasrinAI UI / NCC Workspace
  ├─ Visual Workflow Studio
  ├─ AI Workflow Builder
  ├─ Connections & Permissions
  ├─ Approval Outbox
  └─ Execution Inspector
             |
             v
NCC Control Plane (authenticated server routes)
  ├─ Tenant and account authorization
  ├─ Workflow CRUD, schema validation and immutable versions
  ├─ Trigger registration and schedule management
  ├─ Connector registry and policy checks
  └─ Execution request creation
             |
             v
Durable Execution Plane
  ├─ Scheduler / webhook ingress / manual trigger
  ├─ Durable queue and worker processes
  ├─ Graph executor and node registry
  ├─ Checkpoints, retry policy and cancellation
  └─ Error and recovery workflows
             |
             v
Policy and Integration Boundary
  ├─ Per-node permission checks
  ├─ Secret broker / credential references
  ├─ Outbound network and sandbox restrictions
  ├─ Human approval gates
  └─ Provider adapters and official APIs
             |
             v
Persistence and Observability
  ├─ Supabase PostgreSQL (RLS, tenant-scoped records)
  ├─ Execution logs, metrics and audit events
  ├─ Durable outbound outbox and provider receipts
  └─ Object storage for large artifacts, if needed
```

### Existing-stack deployment guidance

- **Vercel:** retain the existing UI, authenticated API and short-lived control-plane work. Do not rely on a normal request handler to remain alive for long-running workflow execution.
- **Supabase/PostgreSQL:** persist workflow definitions, versions, run state, approvals, connector metadata and outbox state. Keep RLS enabled and browser roles denied for server-only tables as in the current NCC design.
- **Durable queue/workers:** introduce or select a durable background execution mechanism with job recovery, concurrency controls and worker-restart recovery. Redis-backed queue workers are one option, but durability guarantees must be verified. Do not assume Supabase by itself is a complete queue or Vercel functions are persistent workers.
- **Scheduler/webhooks:** convert schedule ticks and external events into authenticated, deduplicated execution requests. Verify webhook signatures where supported.
- **Object storage:** store large outputs/media separately when required, with scoped access and retention rules.
- **Observability:** centralize structured logs, metrics, traces and alerts. Redact credentials, authorization headers, tokens and sensitive payloads.

The queue/worker technology is an architectural decision still to be validated against current infrastructure and deployment constraints; do not add dependencies before that decision.

## 4. Workflow Studio

Provide a responsive, accessible node editor suitable for desktop and iPhone. The editor should support:

- Drag/drop node placement and connections, pan/zoom, search, undo/redo, copy/paste and templates.
- Typed inputs and outputs, field mapping, schema validation and visible configuration errors.
- Draft, validate, publish, compare versions and roll back.
- Test runs with sample/pinned input where safe.
- Per-node input/output inspection, status, duration and error explanation.
- Run history, filtering, cancellation and replay from a safe checkpoint.
- Reusable sub-workflows with explicit input/output contracts.

A workflow's published definition must be immutable. Executions reference a specific published version and node versions, never the unsaved editor state. Secrets must be represented by connection references, not embedded in workflow JSON.

## 5. Standard node contract and categories

All nodes use a versioned contract with typed schemas, declared permissions, validation and an execution function. Conceptual TypeScript shape:

```ts
interface NCCNode {
  type: string;
  version: number;
  inputSchema: object;
  outputSchema: object;
  permissions: string[];
  validate(config: unknown): ValidationResult;
  execute(
    context: ExecutionContext,
    input: unknown,
    config: unknown
  ): Promise<NodeResult>;
}
```

The actual implementation should follow the repository's JavaScript conventions; this interface is illustrative, not a requirement to introduce TypeScript.

| Category | Node examples |
|---|---|
| Triggers | Manual, webhook, schedule, contact created, tag added, deal created/stage changed, task completed |
| Logic | IF, switch, filter, merge, loop, wait, deduplicate |
| Data | Map fields, transform, parse JSON, validate, aggregate |
| AI | Agent, classify, extract, summarize, draft, evaluate |
| Integrations | HTTP request, email, CRM, database, supported third-party service |
| Social | Create draft, preview, approve, publish, delivery-status check |
| Reliability | Retry, error handler, checkpoint, alert, sub-workflow |
| Developer | Sandboxed JavaScript; sandboxed Python only if a reviewed isolated runtime is available |

Validate every node's configuration and inputs/outputs. Apply node-version compatibility and migration rules so old workflows remain readable and reproducible. Never execute user-supplied code inside the main web server. Arbitrary code must run in an isolated sandbox with CPU, memory, wall-clock, filesystem and network restrictions. Shell access is disabled by default and requires a separately authorized isolated environment.

## 6. Trigger and execution lifecycle

Supported trigger families should include manual execution, signed webhooks, schedules, supported application events and sub-workflow calls. Triggers must authenticate, validate payloads, enforce quotas and deduplicate events before creating a run.

Recommended lifecycle:

1. Receive trigger and create a request with a stable event/idempotency key.
2. Authenticate the actor, resolve the tenant, check NCC enablement and authorize the trigger.
3. Load an immutable published workflow version.
4. Validate graph structure, node versions, credentials, permissions, budgets and required configuration.
5. Create a durable execution record and enqueue it.
6. Workers execute ready nodes, persist node state and pass validated outputs to dependent nodes.
7. Pause at an approval gate, persist the pending action, and resume only after a valid authorized decision.
8. Classify failures, retry safe transient errors, or run the configured error workflow.
9. Finalize status and persist sanitized outputs, timing, resource use, provider result and audit events.

Use bounded concurrency, timeouts, retry backoff with jitter, cancellation and execution budgets. A retry must not duplicate an external side effect. Use idempotency keys where supported, and reconcile ambiguous provider outcomes before replaying sends or publishes. Do not claim exactly-once delivery where the external provider cannot guarantee it.

## 7. AI workflow builder and agent policy

Users may describe an automation in natural language. NasrinAI should:

1. Parse the goal and propose a structured plan.
2. Select only registered node types and available connector capabilities.
3. Ask for missing essential configuration, credentials or permissions rather than inventing them.
4. Validate schemas, graph reachability, cycles, budgets and approval gates.
5. Show a readable preview of the workflow and its external effects.
6. Save as a draft and require explicit publication before scheduled/production execution.
7. Execute only within user- and tenant-authorized capabilities.

Agents receive bounded tools and sanitized context. The model cannot grant itself permissions, reveal credentials, disable policy checks, bypass approvals or silently install new connectors. Deterministic operations should not incur unnecessary LLM calls.

### NasrinAI intelligence tiers

Use the existing Quick / Pro / Max / Ultra routing policy, subject to plan entitlements and configured budgets:

- **Quick:** simple classification, extraction and lightweight transformations.
- **Pro:** standard multi-step workflows, summaries and routine orchestration.
- **Max:** complex multi-tool planning and deeper diagnosis.
- **Ultra:** demanding analysis, advanced planning and complex developer workflows.

The orchestrator selects providers based on task complexity, tool availability, latency, context size, privacy policy, plan entitlement and estimated cost. Model choice never overrides connector permissions or action approval. Track actual token/provider usage and enforce both plan allowances and separate anti-abuse rate limits.

## 8. Connector gateway

Provide one integration boundary for native adapters, HTTP APIs, webhooks, databases and approved internal NasrinAI services. Each adapter declares supported actions, input/output schemas, required scopes, rate limits, idempotency support and error mapping.

Required capabilities:

- OAuth connection lifecycle and token refresh where applicable.
- Tenant-bound encrypted credential references; no raw credentials in workflow JSON, browser state or model context.
- Pagination, normalized errors, rate-limit handling and timeouts.
- Allowlisted destinations and SSRF protections, including redirect/DNS/private-network defenses.
- Egress restrictions for code sandboxes.
- Connector health/status and explicit unavailable/reauthorization states.
- Official APIs only for third-party social and messaging platforms.

Do not promise a fixed number of integrations until each adapter exists and is tested. Start with current NCC and NasrinAI integrations, then add connectors incrementally.

## 9. Social media automation and approval outbox

Preserve the existing Meta integration in `src/ncc-meta.js`, channel storage in `ncc_channels`, and `ncc_outbox` behavior described in `docs/ncc.md`. Current supported actions include Facebook Page posts, Instagram publishing, Threads posts and WhatsApp messages; Messenger inbox support is not built yet. Do not imply that all Meta products share the same endpoints, permissions or publishing capabilities.

Recommended flow:

```text
Schedule / CRM Event
  -> Generate platform-specific draft
  -> Validate channel, media, policy and permissions
  -> Create preview and outbox item
  -> Await explicit approval or narrow per-workflow authorization
  -> Claim outbound item atomically
  -> Call the official provider API
  -> Reconcile provider result
  -> Mark sent/published or failed; show actionable reason
```

Keep explicit states: `draft`, `pending_approval`, `approved`, `queued`, `publishing`, `published`, `failed`, `cancelled`. Adapt names to existing schema/state conventions where necessary rather than breaking current clients.

Requirements:

- Default outward actions to approval-required.
- Any unattended-send setting must be opt-in, narrow, visible and scoped to a specific action/workflow/channel.
- Use a stable idempotency key and atomic claim/lease to prevent concurrent duplicate sends.
- Store provider IDs and sanitized delivery results for reconciliation.
- Handle expired tokens, permission failures, rate limits, media constraints and WhatsApp template/window rules.
- Never log access tokens or message contents unnecessarily.
- If a result is ambiguous, reconcile before retrying; never silently report success.
- Confirm channel-specific support and Meta app review requirements before enabling an action.

## 10. Persistence model

Review the existing schema before adding migrations. The current logical data includes `ncc_contacts`, `ncc_deals`, `ncc_tasks`, `ncc_activities`, `ncc_automations`, `ncc_channels` and `ncc_outbox`.

Potential new logical entities, only if equivalent structures do not already exist:

| Entity | Purpose |
|---|---|
| `ncc_workflows` | Workflow identity, owner, tenant and lifecycle |
| `ncc_workflow_versions` | Immutable published definitions and node versions |
| `ncc_executions` | Trigger, workflow version, lifecycle and final outcome |
| `ncc_node_runs` | Node state, timing, sanitized output and error classification |
| `ncc_schedules` | Schedule definition, next run and registration status |
| `ncc_approvals` | Pending action, authorized approver, decision and timestamps |
| `ncc_audit_events` | Security-sensitive workflow, permission and action events |
| `ncc_connections` | Optional normalized connector metadata and credential references |

Do not duplicate current channel/outbox tables. All new migrations must be additive, reviewed, ordered, tested against a clean database and an existing database, and run in staging before production. Every tenant-owned query must be server-authorized and tenant-scoped; keep RLS on and deny browser roles direct access to server-only records. Define retention, export and deletion behavior for new execution data and update privacy/terms documents in the same change when data handling changes.

## 11. Security and governance

- Authenticate every API request; authorize every workflow, run, node, connection, schedule, approval and outbox action server-side.
- Enforce tenant and user ownership in every database operation. Never trust browser-supplied tenant IDs.
- Encrypt connector credentials at rest, limit decryption to authorized execution paths, redact secrets, and support rotation without exposing values.
- Treat AI output, webhook payloads, imported files, connector responses and node output as untrusted data.
- Protect against SSRF, DNS rebinding, malicious redirects, injection, unsafe deserialization and cross-tenant references.
- Apply per-user/tenant concurrency, rate, runtime, memory, output-size and cost budgets.
- Verify webhook signatures, use replay protection, and limit payload size.
- Require approval for publishing, external messages, destructive operations, financial actions and permission changes unless the owner explicitly configured a narrow authorized policy.
- Keep append-only or tamper-evident audit records for security-sensitive events.
- Never store secrets in Git, tests, fixtures, error messages, screenshots or execution logs.
- Ensure user-visible errors are clear without disclosing internal secrets or provider credentials.

## 12. Failure handling, diagnosis and repair

Classify errors into transient, authorization, configuration, validation, rate-limit, provider-permanent and unknown categories.

- **401/403:** report authentication/scope problem; never reveal the token.
- **429:** honor `Retry-After`, back off and enforce quotas.
- **Timeout:** determine whether the action might already have succeeded before retrying.
- **Invalid input:** identify the exact node and field and show expected schema.
- **Missing connector/capability:** stop or take an explicitly configured error branch; do not silently skip.
- **Repeated failure:** stop retry loops and trigger the configured alert/error workflow.

AI-assisted repair may inspect sanitized logs and node metadata, propose a minimal patch, and generate a regression test. Validate the patch in a test execution before promotion. Automatic repair may retry safe transient errors; production changes affecting permissions, credentials, public posts or other side effects require appropriate approval. A rollback is reported only when it was actually executed and verified.

## 13. Observability and operator experience

The NCC execution inspector should show:

- Workflow/version, trigger source, execution ID, tenant-scoped owner and lifecycle state.
- Per-node queued/running/succeeded/failed/skipped status, duration and retry count.
- Sanitized input/output, validation results and actionable error messages.
- Approval waiting state, approver decision and outbound provider status.
- Queue delay, worker health, failure rates, retries, cost/token use and quota consumption.
- Search/filter by workflow, status, date and error category.
- Safe retry/replay and cancellation controls with authorization checks.

Provide operational alerts for queue backlog, repeated failures, expired connectors, scheduler drift and exhausted quotas. Never expose another tenant's run or artifact in search, logs or UI.

## 14. Implementation roadmap (one focused PR per phase)

### Phase 0 — Repository audit and baseline
- Inspect current NCC UI, `src/ncc.js`, `src/ncc-automations.js`, `src/ncc-meta.js`, migrations, tests, scheduler/cron setup and Vercel limits.
- Trace the real trigger-to-run-to-result path and confirm what executes today.
- Document existing state machines and avoid duplicating tables/routes.
- Record baseline tests and known gaps. No architecture-only document should be represented as shipped functionality.

### Phase 1 — Reliable execution core
- Define node contracts and workflow schema validation.
- Persist immutable versions and execution/node-run states.
- Implement bounded graph execution, timeout, cancellation, safe retries, idempotency and error states.
- Demonstrate restart recovery using the selected durable queue/worker approach.

### Phase 2 — Workflow Studio
- Improve the visual editor, node inspector, validation, version history and test-run UX.
- Keep draft and published states separate.
- Provide accessible desktop/mobile interaction and actionable validation errors.

### Phase 3 — Connectors and governance
- Normalize connector capabilities, credential references and error mapping.
- Add webhook verification, network restrictions, permissions, quotas and audit events.
- Add connectors only after their capabilities and failure behavior are tested.

### Phase 4 — Social and CRM automation hardening
- Verify the current Meta approval outbox end-to-end in staging.
- Add schedule/event triggers and supported sub-workflows.
- Test duplicate events, expired credentials, ambiguous timeouts, rate limits and per-channel restrictions.
- Keep Messenger marked planned until implemented and verified.

### Phase 5 — AI workflow generation and repair
- Generate schema-valid draft workflows from user goals.
- Add safe test mode, bounded tool selection and cost limits.
- Add failure diagnosis, candidate patches and regression tests.
- Keep authorization and approvals outside the model's control.

### Phase 6 — Production operations and scale
- Load-test queue and worker behavior with documented target workloads.
- Test worker crash/restart, queue backlog, database failure, provider outage and recovery.
- Add dashboards, alerts, backup/restore and retention controls.
- Enable features gradually behind explicit flags and account allowlists.

## 15. Acceptance tests / release gates

A phase is not complete until relevant automated tests and staging verification pass.

- [ ] A workflow can be drafted, validated, published, executed and inspected end-to-end.
- [ ] Executions reference immutable workflow versions.
- [ ] Worker restart preserves and recovers eligible queued/running work.
- [ ] Duplicate webhook/event delivery cannot create duplicate side effects.
- [ ] Timeouts and ambiguous provider outcomes do not blindly replay outbound actions.
- [ ] Cross-tenant access tests fail securely for workflows, runs, connections, approvals, artifacts and outbox items.
- [ ] Disabled NCC accounts and unauthorized channel actions cannot execute.
- [ ] Approval-required posts/messages cannot bypass the approval policy.
- [ ] Provider failure and missing capability are visible; success is reported only when verified.
- [ ] Expired credentials and permission failures produce safe, actionable errors.
- [ ] Sandboxed code cannot access host secrets or unrestricted private network targets.
- [ ] Runtime, memory, output, concurrency, token and cost budgets are enforced.
- [ ] Logs, traces, errors, tests and screenshots do not expose secrets or unnecessary customer data.
- [ ] Database migrations pass clean-install and upgrade tests; RLS and server-only grants are verified.
- [ ] Privacy, Terms, export and deletion behavior are updated where required.
- [ ] `npm test` and database tests pass; live-provider staging tests are clearly distinguished from mocked tests.
- [ ] Feature flags remain off for accounts/channels not explicitly enabled.

## 16. Repository workflow and release discipline

Follow `CLAUDE.md` and `docs/claude-code-handoff.md`:

- Inspect the actual code and branch state before implementation.
- Keep changes focused and reviewable; use a short-lived feature branch.
- Do not work directly on `main`, force-push, rewrite history or merge without the owner's authorization.
- Run `npm test` and relevant database/security/integration tests; do not hand over a PR with failing checks.
- Use staging before production; do not point production DNS or secrets at staging.
- Update `docs/ncc.md`, `CLAUDE.md`, changelog and legal documents when implementation or data handling changes.
- Keep this architecture document aspirational where a feature is not yet implemented. Update its status only after code, tests and staging evidence confirm the capability.
- Never commit or print API keys, tokens, database dumps or customer data.

## 17. Decisions still requiring verification or owner input

- Select a durable queue/worker implementation that fits the no-new-runtime-dependency rule, or request explicit approval for an exception.
- Confirm execution-data retention, export and deletion policy before storing expanded node inputs/outputs.
- Confirm target workload, concurrency and latency objectives before making scale claims.
- Confirm connector list and provider permissions one adapter at a time; do not promise a fixed integration count.
- Complete enterprise contract and data-processing terms per the existing `docs/ncc.md` owner-input list.
- Complete Meta app review and verify each channel capability before production enablement.

## Definition of success

NCC is successful when a business user can describe or visually build a workflow, validate it, authorize its effects, run it reliably, inspect every step, understand failures, and recover safely—without silent skips, duplicate outbound actions, cross-tenant access or secrets exposed to models or logs.


## 18. Reference interaction model — connected, agentic node canvas

The target UX is the node canvas shown in the owner's reference image: a trigger node flows into an AI Agent node; the agent has separate **Chat Model**, **Memory**, and **Tool** connections; its result enters an IF/Switch node; true/false branches lead to different application actions. This is a core NCC interaction pattern, not merely a static diagram.

### Canvas behavior

- Every node is a visible card with an icon, name, configured operation, status and input/output ports.
- Users connect output ports to compatible input ports by dragging edges. The editor highlights valid targets and rejects incompatible types with a clear explanation.
- Main workflow edges carry execution data. AI sub-connections are visually distinct and typed: Chat Model, Memory and Tool.
- Branch nodes expose named outputs such as true/false, matched/unmatched, success/error. Each branch's condition is editable and testable.
- Tool nodes connect to an agent through a tool port, and the agent can choose only among tools explicitly connected and authorized for that workflow.
- The canvas supports zoom, pan, fit-to-workflow, node search, keyboard navigation, undo/redo, multi-select, copy/paste, duplicate, disable, notes and reusable subflows.
- Selecting a node opens a configuration/inspection panel with fields, credential reference selector, required scopes, input/output schema, test action and documentation.
- Run mode displays node state, duration, sanitized input/output, retries and error details. A node that was not reached must be marked skipped/not-run, never shown as successful.
- Provide both an interactive canvas and a simple step/list view for mobile and accessibility. Do not make precise drag-and-drop the only way to edit on iPhone.
- Draft edits do not alter the currently published version. Publish shows a diff and validates the graph before activation.

### Agent node contract

The Agent node is an orchestrator for bounded tool calls, not a replacement for the graph runtime. It receives a task and permitted context, reasons using the configured chat model, and may invoke only its connected tools. Each invocation is validated and authorized by the server. The agent has configurable iteration, time, token/cost and tool-call budgets. It returns structured output matching a declared schema and a trace of tool names/results with sensitive values redacted.

- **Chat Model port:** references a supported NasrinAI model/provider configuration; it never stores a provider key in the workflow.
- **Memory port:** optional, tenant-scoped memory with explicit retention and data minimization. Memory is not an authorization source. Do not train on business customer data by default.
- **Tool port:** one or more registered, typed, permissioned tools. A tool may read data, transform data or request a write action; write-capable tools enforce policy at invocation time.
- **Human approval:** agent proposals for external or consequential side effects pause at a durable approval gate when required. The agent cannot approve its own action.
- **Structured output:** downstream IF/Switch nodes should branch on validated fields, not parse arbitrary free-form prose when a typed result is possible.
- **Loop prevention:** cap agent iterations and workflow recursion; track call budgets and detect repeated identical tool calls.

### Example matching the reference image

```text
[Form/Webhook Trigger: Create User]
                 |
                 v
       [AI Agent: Provision User]
          |       |        |
          |       |        +-- Tool port --> [Directory: Find User]
          |       |        +-- Tool port --> [Jira: Create User]
          |       |
          |       +-- Memory port --> [Tenant-scoped approved memory]
          +---------- Chat Model port --> [Configured NasrinAI model]
                 |
                 v
          [IF: Is Manager?]
              /       \
           true       false
            |           |
            v           v
 [Slack: Invite to   [Directory/Jira:
  approved channel]   Update user profile]
            \           /
             v         v
          [Record Result / Notify]
```

This is illustrative. The actual available operations depend on connected and verified adapters; Slack, directory and Jira actions must not appear executable until their connector, permissions and credentials are configured.

### Universal capability model

“Do everything” means the canvas can orchestrate any operation exposed by a registered, authorized node or connector—not unrestricted access to every website, account, machine or API. NCC should support:

1. Built-in trigger, logic, data, AI, approval, error and utility nodes.
2. Registered native service connectors with explicit operation catalogs.
3. A secure HTTP/API node for authorized destinations, with schema validation and SSRF/egress protections.
4. Webhook send/receive nodes with signature verification and replay protection.
5. Reusable sub-workflows and bounded AI agents that combine multiple tools.
6. Sandboxed custom code only when the isolated runtime is available and approved; shell execution stays disabled by default.
7. A capability catalog that tells users which connectors/actions are available, what permissions are required, and whether the action is read-only, reversible or externally consequential.

Unknown integrations should be reported as unavailable or offered as a draft connector configuration. NCC must never invent a successful integration, silently skip a missing node, or claim an external action completed without a verified result.

### Additional acceptance criteria for the canvas

- [ ] A user can recreate the trigger → AI Agent → IF true/false → action branches pattern shown in the reference.
- [ ] Chat Model, Memory and Tool connections are separate, typed and validated.
- [ ] The agent cannot invoke tools that are not connected, registered and authorized.
- [ ] Conditional branches route using typed output values and have testable conditions.
- [ ] The run inspector shows the actual executed path and node-level results.
- [ ] Editing a draft cannot mutate an active published workflow.
- [ ] Mobile users can configure and inspect workflows without relying exclusively on drag-and-drop.
- [ ] Missing connectors, invalid scopes and disabled actions fail visibly and securely.


## 19. CRM, automatic lead response, sales, customer behavior and trends

This section is a required implementation specification for Claude Code. Implement it in staged, testable PRs after auditing the current NCC code. Do not leave these capabilities as design-only placeholders once a phase is approved. Preserve tenant isolation, official API rules, the approval policy, current CRM data and the zero-runtime-dependency constraint. Update `docs/ncc.md`, migrations, tests and privacy/terms documentation as each capability ships.

### 19.1 Customer and client relationship management (CRM)

NCC must provide a complete, tenant-scoped CRM for leads, prospects, customers and business clients:

- Unified customer profile with name, contact channels, company, source, assigned owner, lifecycle stage, tags, custom fields, consent/preferences, notes, tasks, deals, interactions and timeline.
- Search, filters, segments, duplicate detection/merge with audit trail, CSV import/export and controlled deletion.
- Lead and sales pipeline boards with configurable stages, deal value/currency, expected close date, owner, source and win/loss reason.
- Full activity timeline for inbound/outbound messages, calls/notes entered by users, form submissions, appointments, purchases and workflow actions when integrations supply those events.
- Customer profile summary and recommended next action generated by AI from authorized, relevant records. AI summaries must be clearly identified as generated and traceable to source records.
- Role-based assignment, ownership transfer, team queues, follow-up tasks, reminders and escalation.
- Track consent, opt-outs, channel permissions and suppression lists; an opt-out must prevent prohibited marketing sends across applicable workflows.
- Account export and deletion must include new CRM/analytics records according to the product's approved retention and legal policies.

Do not invent customer details or infer sensitive attributes. Separate verified facts from model-generated hypotheses. Minimize personal data and never use business customer records for model training by default.

### 19.2 Lead and sales triggers

Add typed triggers to the visual canvas. Trigger payloads must include a tenant-scoped entity reference, event ID, event timestamp, source, and validated event data; avoid copying unnecessary personal data into queue payloads.

**Lead triggers**
- New lead/contact from a connected form, website chat, supported social/messaging inbox, API or manual entry.
- Lead source, campaign, tag, status or owner changed.
- Lead qualifies or disqualifies; lead score crosses a configured threshold.
- No reply within a configured interval; lead responds after a quiet period.
- Duplicate detected; consent or opt-out changes.
- New inbound conversation or message, only for channels with a verified supported webhook/inbox integration.

**Sales triggers**
- Deal created, value/owner/stage changed, won/lost, or close date approaching/overdue.
- Quote/proposal requested, sent, accepted or expired, where a connected system provides the event.
- Customer purchases, renews, cancels or payment fails, only when supplied by an authorized integration.
- Follow-up task due/overdue or completed.
- Lead/customer inactive for a configured interval; customer returns after inactivity.
- Sales target, conversion rate or other configured metric crosses a threshold.

**Customer behavior and trends triggers**
- Customer repeats an observable event such as visiting a tracked page, submitting a form, clicking a tracked campaign link, opening a supported conversation, making a purchase or abandoning a supported checkout.
- Segment membership changes, repeat-purchase threshold is reached, usage declines, or churn-risk indicator crosses a configured threshold.
- A statistically meaningful trend or anomaly is detected in aggregated, permitted business data.

Only use behavior events that the business has permission and a valid integration to collect. Do not claim website tracking, email opens, clicks, purchases or social inbox events are available unless the corresponding connector is implemented and verified.

### 19.3 Automatic replies and lead qualification

Implement an n8n-style inbound-response workflow:

```text
Inbound lead / customer message
  -> Verify source, signature, tenant, channel and deduplication key
  -> Check consent, opt-out, business hours and channel rules
  -> Find or create CRM contact; attach conversation to profile
  -> Load permitted business knowledge and relevant customer history
  -> AI classifies intent and drafts a concise reply / qualification questions
  -> Validate reply against policy, source evidence and channel constraints
  -> Send automatically only when the owner enabled this exact workflow/channel
     and the reply meets the configured low-risk policy; otherwise queue for approval
  -> Record inbound/outbound event and update CRM
  -> Schedule next follow-up or escalate to a human
```

Requirements:

- Configure response behavior per channel, workflow, business hours, language, response tone, allowed topics and human handoff rules.
- Support FAQ answers, lead acknowledgement, qualification questions, appointment interest, product/service inquiries and follow-up drafts based on approved business knowledge.
- Qualify using configurable, non-sensitive business fields such as stated need, product interest, budget range if volunteered, timeline, service area and readiness. Do not infer protected/sensitive characteristics.
- Generate a structured lead summary, source, qualification status, next step and optional explainable score. Scores must use disclosed, configurable signals and must not make consequential decisions about people without human review.
- Use a conversation-level lock/idempotency key, provider message ID and inbound event ID to prevent duplicate replies, loops and self-replies.
- Do not reply to the business's own messages, webhook echoes, unsupported events, blocked contacts or opted-out recipients.
- Respect platform messaging windows, approved templates, rate limits and channel-specific rules. Never bypass platform policy.
- Use a human handoff when confidence is low, the customer requests a person, the issue is sensitive/high impact, the customer is angry or repeated attempts fail.
- Keep an auditable record of the trigger, generated draft, policy decision, approval, send result and subsequent CRM updates. Redact credentials and avoid logging full message bodies unless retention policy permits.
- Automatic sending must be disabled by default until the owner explicitly configures and verifies the exact channel/action. A general “AI enabled” toggle is not sufficient authorization.

### 19.4 Follow-up and sales pipeline automation

Support configurable workflows such as:

- New lead -> acknowledge inquiry -> create/associate CRM record -> assign owner -> create follow-up task.
- Qualified lead -> move to Qualified stage -> notify assigned salesperson -> schedule next action.
- No response after N hours/days -> create reminder or prepare a follow-up draft; send only under the specific authorized policy.
- Meeting/proposal event -> update deal stage and due date when supported by a verified integration.
- Won deal -> record win and value, trigger approved onboarding tasks and notify the team.
- Lost deal -> capture a permitted reason, stop inappropriate follow-ups and optionally schedule a future re-engagement consistent with consent.
- Customer complaint or high-risk support request -> pause sales automation and escalate to a human.
- Opt-out -> update suppression state and cancel prohibited queued marketing sends.
- Task overdue or owner unavailable -> reassign or alert according to a business-configured rule.

Avoid infinite trigger loops: tag/stage/task changes made by an automation must carry execution provenance, have bounded recursion and be deduplicated. Imports and bulk updates should not unexpectedly trigger large-scale messaging; provide a preview and explicit opt-in for bulk-trigger execution.

### 19.5 Scheduled social posts and attachments up to 1 GB

Build a content calendar and durable publishing scheduler for supported social channels. Users should be able to create drafts, attach supported media, preview per channel, schedule a date/time with timezone, edit/reschedule, cancel, duplicate a post and inspect delivery results.

Supported attachment types should be capability-driven: photos, videos, link previews and any additional media types supported by the exact platform/API. Provide channel-specific validation for file type, duration, dimensions, aspect ratio, captions, link formats, text limits and account permissions. Do not assume one media payload works across all platforms.

**Large-file target:** support source uploads up to 1 GB only where the selected storage, hosting, platform and provider upload APIs can reliably support it. Do not send a 1 GB file through a Vercel request body or store it in a PostgreSQL row. Use a secure direct-to-object-storage upload flow with short-lived signed upload authorization, chunked/resumable multipart upload where available, server-side finalization, checksum verification, MIME/signature validation, malware scanning where supported, and scoped deletion/retention. Keep metadata and storage references in the database, not the media bytes.

Before enabling a 1 GB attachment, verify the entire path: browser/iPhone upload capability, object-storage limits, signed URL policy, maximum file size, resumability, available storage, egress cost, provider-side media upload limits, processing time and platform publishing eligibility. If a provider's API or account does not support that file size/type, explain the limit and reject it before scheduling. Never advertise universal 1 GB social publishing when a channel's actual API does not support it.

**Scheduling and delivery**
- Persist scheduled jobs with timezone, due time, workflow/version, channel, media references, approval state and a stable idempotency key.
- Use a durable scheduler/queue/worker; do not rely on a browser tab or a long-running Vercel request.
- Claim jobs atomically, honor provider rate limits, refresh credentials through the authorized connector, and reconcile uncertain outcomes before retrying.
- Require approval by default. Permit unattended publication only after explicit per-workflow/channel authorization and applicable policy checks.
- Handle expired credentials, deleted media, invalid formats, provider outages, rate limits, rejected posts and partial multi-channel success independently per channel.
- Show calendar status such as draft, upload processing, pending approval, scheduled, publishing, published, failed, cancelled and partially published.
- Provide a dry run/preview and clear timezone display; record who approved or changed the schedule.
- Support upload cancellation, orphan cleanup, retention/deletion policy and limits on total stored media and scheduled jobs.

### 19.6 Automatic counts, dashboards and customer trends

Create server-side analytics from auditable CRM/event records, not from AI guesses. Show filterable date ranges, source/channel, campaign, assigned owner, pipeline stage and team where authorized.

**Lead metrics**
- Total new leads, qualified leads, disqualified leads, duplicates and currently open leads.
- Leads by source/channel/campaign, owner and lifecycle stage.
- Lead response time, first-response SLA, overdue follow-ups and lead-to-opportunity conversion.

**Sales metrics**
- Deals created, open pipeline value, won/lost count and value, win rate, average deal size, sales cycle length and stage conversion.
- Revenue by period, product/source/owner where reliable transaction data exists.
- Forecasts must be labelled estimates and disclose assumptions; do not call pipeline value realized revenue.

**Customer metrics**
- New vs returning customers, repeat purchase frequency and value only when purchase data is integrated.
- Active/inactive customers, last interaction, unresolved issues, follow-up due and opt-out counts.
- Customer satisfaction or sentiment only when supported by collected feedback; label AI-derived sentiment as an estimate and allow review.

**Behavior and trend metrics**
- Top inquiry topics, product/service interest, common objections, frequently asked questions, lead source changes, campaign performance and time-of-day/day-of-week patterns where event volume supports it.
- Customer journey/funnel and cohort summaries where events are consistently tracked.
- Anomaly and trend alerts with baseline, sample size, time window and confidence/limitations.
- Explain what changed and which records/events support the insight; link back to authorized CRM records rather than exposing other tenants' data.

Use deterministic aggregation for counts, totals, conversion rates and financial metrics. Use AI to summarize trends or propose hypotheses only after calculations are produced from source data. Never ask an LLM to invent or estimate exact counts from a text sample. Define denominator, time zone, currency, deduplication and attribution rules. Distinguish missing data from zero and estimates from measured values.

### 19.7 Data and implementation implications

Audit current `ncc_contacts`, `ncc_deals`, `ncc_tasks`, `ncc_activities`, `ncc_automations`, `ncc_channels` and `ncc_outbox` before changing schema. Reuse existing structures where practical; add migrations only for demonstrated gaps. Potential additions include conversation/message references, lead source/campaign fields, custom fields, event ledger, content calendar/scheduled posts, media metadata, upload sessions, delivery attempts and aggregate/reporting views. These are logical concepts, not instructions to create duplicate tables blindly.

Every new table must have tenant-scoped access controls and database tests. Use an append-only or auditable event record for metrics that must be reproducible. Design idempotent event ingestion, deduplication, retention, deletion and re-aggregation. Large media stays in object storage. Do not place access tokens, raw credentials or unnecessary message content in event payloads.

Because customer profiles, messages, behavior events and media add data-processing obligations, update `public/legal/privacy.md`, `public/legal/terms.md`, version defaults in `src/config.js`, and export/deletion behavior in the same implementation PR whenever collection, purpose, sharing or retention changes. Business-specific legal and retention decisions remain owner inputs; do not invent them.

### 19.8 Required implementation phases

Deliver this as small, reviewable PRs and stop for owner approval between phases as required by `CLAUDE.md`.

1. **CRM data and event foundation:** audit current schema; add only necessary fields/tables, typed event contracts, deduplication, RLS and database tests.
2. **Lead triggers and automated response:** implement supported inbound webhook/event sources, contact matching, response policy, approval outbox, human handoff, loop prevention and end-to-end staging tests.
3. **Sales automation:** add pipeline triggers, assignment, follow-up timers, reminders, escalation, consent/opt-out enforcement and recursion controls.
4. **Content calendar and uploads:** implement secure direct/resumable uploads, media validation, per-channel preview, schedule persistence, approval and delivery reconciliation. Prove storage and provider size limits before claiming 1 GB support.
5. **Analytics and trends:** implement reproducible server-side metrics, filters, dashboards, trend explanations, thresholds and alerts using source-backed data.
6. **AI agent canvas integration:** expose these trigger/action/analytics capabilities as typed nodes and bounded Agent tools, only after the underlying APIs and policies are implemented.
7. **Production hardening:** run tenant-isolation, permission, duplicate-event, queue-restart, upload-abuse, large-file, provider-outage, opt-out, retry and privacy/export/delete tests in staging before enabling production accounts.

### 19.9 Acceptance criteria — required before declaring complete

- [ ] A new lead from every claimed supported source is captured once, linked to the correct tenant/contact, and attributed to its source.
- [ ] Automatic replies only send for explicitly authorized channel/workflow combinations; otherwise they remain drafts/pending approval.
- [ ] Inbound echoes, duplicate webhooks, opt-outs and blocked contacts cannot trigger reply loops or prohibited sends.
- [ ] Lead qualification, assignment, reminders, pipeline changes and human escalation are configurable and visible in the timeline.
- [ ] Sales and customer metrics match deterministic SQL/source-record calculations for test fixtures.
- [ ] Dashboards distinguish zero from missing data, estimates from actuals, and pipeline value from revenue.
- [ ] Trend alerts identify their time range, baseline, sample size and source events.
- [ ] Scheduled posts persist and run without an open browser; timezone, edit/cancel, approval, retries and per-channel results are tested.
- [ ] Large media uploads use a secure resumable/direct-upload design and never pass a 1 GB body through a Vercel function or database row.
- [ ] A 1 GB test file succeeds only on a verified compatible storage/provider path; unsupported channels reject it with a clear reason.
- [ ] Media references, scheduled posts, analytics and CRM data obey tenant isolation, retention, export and deletion rules.
- [ ] Cross-tenant tests, opt-out tests, secret scans, migration tests, `npm test` and relevant database tests pass.
- [ ] The feature remains disabled for unapproved accounts and channels until staging verification and owner authorization.

**Definition of done:** Claude Code must inspect the repository, implement the approved phase in real code and migrations, add regression/security tests, update the relevant docs/legal files, run required checks, and report exact files changed plus any owner action required. Do not stop after rewriting documentation, claim unimplemented integrations work, or merge/deploy without the repository's required approval path.


## 20. Vercel-only environment configuration — mandatory project-wide rule

This is a required configuration rule for NasrinAI and NCC implementation work. **All environment-specific configuration and secrets must be managed through the appropriate Vercel Project Environment Variables for the relevant project and deployment environment.** This includes production, preview and development values where the project uses Vercel for those environments.

Requirements:

- Do not hardcode API keys, tokens, passwords, database credentials, signing secrets, provider IDs, private URLs, allowlists, quota/usage limits, feature flags, model/provider choices, origin allowlists, owner-account configuration, or other deployment-specific values in source code, client bundles, SQL migrations, tests, workflow definitions or documentation examples that could be mistaken for real configuration.
- Do not add silent fallback values or embedded production defaults for environment-driven settings. If a required variable is absent or invalid, validate it server-side and fail closed with a clear, non-sensitive configuration error. Do not silently switch to a weaker security policy, another account, another provider, a permissive origin, or a hardcoded quota.
- Keep secret variables server-only. Never prefix secrets with a public/client-exposed variable convention, return them in API responses, render them in the browser, place them in model context, or write them to logs.
- Values that genuinely must be public browser configuration may be exposed only when intentionally designed as public, non-secret values, with access restricted by server-side authorization where needed. A value being stored in Vercel does not make a secret safe to expose to the client.
- Use a central server-side configuration validation layer with explicit schemas, required/optional status, environment scope, safe validation messages and tests. Avoid scattering raw `process.env` reads throughout unrelated modules.
- For every new environment variable, document its exact name, purpose, allowed format, which Vercel project/environment it belongs to, whether it is secret, and required/optional behavior. Add it to a configuration inventory/checklist, not as a literal value. Never invent credentials or pretend a variable has been configured.
- Production-critical configuration must be explicitly set in Vercel for the intended project and environment. A local `.env.example` may list variable names and placeholder descriptions only; never include live values. Local development may use a developer-owned local environment file only when needed, but it must never become a production source of truth or be committed.
- Do not use a checked-in `.env`, config JSON, database seed, migration, or source constant as an alternative store for deployment secrets or changeable deployment policy. Vercel environment variables are the source of truth for deployment configuration. Runtime business data (such as saved workflow definitions, CRM records, consent records and call history) belongs in the authorized database, not in environment variables.
- Vercel environment-variable changes require the correct project/environment and a new deployment when required by Vercel. Verify the active deployment and runtime behavior after changes; do not claim configuration is live based only on a code change.
- Tests must cover missing, malformed and valid required configuration. Test fixtures may use clearly fake values in test-only contexts; never copy real credentials into fixtures. Security scans must catch accidental secrets.
- Before creating or modifying an environment variable, inspect the existing configuration contract and Vercel project/environment. Avoid duplicate or competing names. If an owner action is needed to set a value in the Vercel dashboard, report the exact variable name and scope without requesting that the owner paste its secret into chat.

This rule does not mean every runtime record should be stored in Vercel: Vercel stores deployment configuration; Supabase or another approved persistent data store stores application data. Never put high-volume runtime records, customer records, workflow executions, call history or media blobs into environment variables.

### Configuration acceptance criteria

- [ ] No secret or deployment-specific policy is hardcoded into application code.
- [ ] No silent fallback exists for required provider, auth, quota, origin, owner-access or voice/telephony configuration.
- [ ] Required values are documented by name and configured in the correct Vercel project/environment.
- [ ] Missing or invalid configuration fails closed with safe diagnostics.
- [ ] Public/client bundles contain no server secrets.
- [ ] Tests cover missing/invalid configuration and security scans pass.
- [ ] Deployment/runtime verification confirms the intended Vercel environment is active.


## 21. NCC AI Agents Front Desk — inbound calls and outbound/scheduled callbacks

### 21.1 Product placement and status

Add **AI Agents Front Desk** as a first-class module inside **NCC — Nasrin Client Connect**, integrated with the NCC CRM, Automation Studio, contact timeline, workflow triggers, scheduler, approval policy, analytics and execution history. It is not a feature of NasrinAI Connect (the separate website/widget integration product).

This is a planned capability until a real telephony adapter, supported voice/media runtime, Vercel configuration, provider webhooks and end-to-end staging tests have been verified. Do not present mock calls or a design screen as a functioning phone system.

### 21.2 Inbound customer calls

The AI front-desk agent should be able to:

- Answer calls on an owner-configured and verified business phone number.
- Clearly disclose at the beginning of the call that it is an AI agent acting for the business.
- Use a configured greeting, supported language and business-approved knowledge base to answer FAQs and service/product questions without inventing pricing, policies, stock, availability or promises.
- Understand caller intent, handle interruptions and unclear audio, ask clarifying questions, and gracefully recover from silence or provider/network problems.
- Identify or match a caller to a CRM contact using permitted data; verify identity before revealing account-specific or sensitive information.
- Capture a new lead, record the inquiry and ask approved, non-sensitive qualification questions.
- Check availability, book/reschedule/cancel appointments or update CRM records only through a connected, authorized API; repeat critical details and report success only after the external system confirms success.
- Transfer the call to a human, take a message, create a callback task or route to voicemail when requested, when confidence is low, when the issue is sensitive/high-impact, when a complaint escalates, or when the agent cannot safely resolve the request.
- Respect business hours, holidays, configured routing, fallback numbers, queue state and after-hours handling.
- Record call disposition, a concise permitted summary, follow-up tasks and CRM activity with tenant isolation and configured retention.

The agent must not impersonate a human, claim a booking/payment/refund/action succeeded without verified confirmation, or provide unapproved legal, medical or financial advice.

### 21.3 Outbound and scheduled callbacks

Support outbound calls for eligible, authorized purposes, including:

- A callback explicitly requested by a customer.
- Replies to a customer inquiry when calling is permitted.
- Appointment confirmations, reminders, rescheduling and service notifications.
- Follow-up on an existing support case.
- Lead follow-up only when the business has the required consent/legal basis and the contact is eligible under applicable rules.
- Owner-approved, narrowly scoped campaigns only after the basic callback flow is tested.

NCC must support a callback queue with scheduled date/time and timezone, reason, contact, assigned workflow, attempt count, retry window, status, outcome, next action, and audit trail. Users should be able to reschedule or cancel a pending callback. Scheduled callbacks must execute from a durable scheduler/queue/worker, not from a browser tab or a long-lived Vercel request.

Outbound calling must be disabled by default until the owner has configured and verified the telephony provider and phone number, relevant Vercel variables, business calling policy and exact workflow permissions. Before each call, enforce contact preferences, consent/legal basis, do-not-call and suppression lists, opt-outs, applicable local calling hours, jurisdiction/provider rules, per-contact attempt limits, concurrency limits and spending budgets. An opt-out must be recorded immediately and suppress future prohibited calls across relevant workflows.

Do not spoof caller ID, hide the agent's identity, harass recipients, make unlawful robocalls or launch broad campaigns without explicit authorization. Campaigns require audience preview, purpose/script preview, schedule and timezone, attempt/concurrency limits, explicit launch confirmation, monitoring and an emergency stop. A general “AI enabled” switch is not authorization for outbound calls.

### 21.4 Voice architecture and integrations

Create a provider-neutral adapter boundary for phone numbers, inbound/outbound call control, transfer, call status webhooks, audio streaming, speech recognition, speech synthesis and optional real-time voice models. Select a provider only after verifying supported countries/regions (including Philippine number availability if required), number provisioning, outbound caller ID, transfer, webhooks, recording controls, concurrency, pricing, rate limits, privacy/data location and operational reliability.

- Authenticate and verify provider webhooks; prevent replay and forged call events.
- Keep credentials in server-only Vercel environment variables or an approved encrypted secret/connection service explicitly designed for runtime rotation. Never embed credentials in code, prompts, workflow JSON, browser state or logs.
- Keep all deployment-specific voice settings—provider selection, account/number IDs, webhook secrets, allowed origins, feature flags, concurrency and cost limits, call-duration limits and rollout switches—in the relevant Vercel project's environment configuration. Do not use hardcoded defaults or silent fallback values for required configuration.
- Use a compatible runtime for persistent real-time audio/media sessions. Do not assume ordinary Vercel functions can host long-lived media streams; Vercel may serve the dashboard and short-lived control-plane APIs while a separately approved compatible service handles the media session and durable workers.
- Isolate every call/session by tenant and provider call ID. Enforce maximum duration, concurrency, per-tenant budgets, rate limits, timeouts, safe disconnect handling and a global emergency stop.
- If a required provider or runtime is missing, fail closed and show a safe setup status; do not simulate a successful call.

### 21.5 Recording, transcription, privacy and consent

Recording and transcription must be separately configurable from answering calls. Do not enable recording/transcription by default until the owner has configured lawful notice/consent, purpose, retention and access rules for applicable jurisdictions. Provide clear caller notice and obtain consent when required; provide an appropriate alternative if the caller declines.

Store only data needed for the configured purpose. Prefer concise summaries and structured outcomes over indefinite retention of full recordings/transcripts. If enabled, recordings and transcripts require tenant-scoped protected storage, encryption, strict access controls, retention/deletion/export behavior and audit logs. Redact payment data, credentials and unnecessary sensitive information from model context and logs. Do not use customer calls for model training by default. Update the privacy/terms documents and deletion/export workflows before enabling new call-data collection.

### 21.6 NCC user interface and analytics

Add these screens or views:

- **Front Desk Setup:** provider/number status, business profile, hours, supported languages, greeting, human fallback and configuration health.
- **Agent Behavior:** approved knowledge, supported intents, response boundaries, transfer conditions, disclosure and test-call harness.
- **Call Inbox:** incoming, missed, active/finished, voicemail where supported, requested callbacks, unresolved issues and human handoff.
- **Callback Scheduler:** date/time/timezone, reason, contact, attempt history, status, reschedule/cancel, retries and outcome.
- **Outbound Controls:** eligible audience, authorization, call purpose, script, schedule, attempt budget, rate/cost limit, launch confirmation and kill switch.
- **Call Details:** provider call ID, direction, duration, status, disposition, verified action results, permitted summary, handoff and recording/transcript only if authorized.
- **CRM Timeline:** associate calls and outcomes with the correct tenant-scoped contact/lead/deal and create follow-up tasks without duplicates.
- **Analytics:** inbound/outbound call volume, answer/missed-call rate, transfer/handoff rate, callback completion, appointment outcomes, lead qualification, failure rate, opt-outs, provider costs and budget consumption.

Use deterministic calculations for counts and rates. Label AI-generated summaries/classifications as AI-generated, and make them traceable to authorized events.

### 21.7 Persistence, reliability and data model

Audit existing NCC contacts, activities, tasks, automations, channels, outbox, connection and execution schemas before migrations. Reuse current structures when possible. Add call sessions/events, callback jobs or configuration records only when a verified schema gap exists. Persist callback schedules and job state in a durable store and queue; do not attempt to store customer records, call history or workflow executions in Vercel environment variables.

Use provider event IDs and idempotency keys to prevent duplicate callbacks, duplicate CRM writes and webhook loops. Retry only safe transient failures with bounded backoff. Reconcile ambiguous call outcomes before retrying; never promise exactly-once provider behavior without evidence. Store provider receipts and sanitized errors for support.

### 21.8 Implementation phases and acceptance criteria

Deliver in small, reviewable PRs:

1. **Audit and design:** inspect existing NCC CRM, automation engine, hosting limits, configuration validation, current Vercel project/environment and legal/privacy docs; select a provider/runtime only after a capability and cost review.
2. **Provider abstraction and mock harness:** implement typed adapter contracts, webhook verification tests, config validation and simulated call-state tests. Do not call this production telephony.
3. **Inbound pilot:** connect a verified test number, disclose AI identity, answer approved FAQs, capture leads, create verified CRM activity and transfer/fallback to a human.
4. **Requested/scheduled callbacks:** add durable callback scheduling, cancellation/rescheduling, local-time policy, suppression/consent checks, bounded retries, spending controls and verified delivery outcomes.
5. **Outbound expansion:** enable narrowly scoped reminders/follow-ups, then optional campaigns only after owner authorization, jurisdiction/legal review and end-to-end staging evidence.
6. **Production hardening:** test tenant isolation, forged/replayed webhooks, duplicate events, provider outage, low confidence, human transfer, opt-out, missing Vercel variables, recording consent, deletion/export, cost caps and emergency stop.

Acceptance criteria:

- [ ] Inbound test calls are answered on a verified number and clearly disclose AI identity.
- [ ] Approved knowledge is used; unknown answers safely escalate rather than hallucinate business policy.
- [ ] Caller verification protects account-specific information.
- [ ] CRM and scheduling actions are confirmed by real connected systems before being reported successful.
- [ ] A customer-requested callback can be scheduled, cancelled/rescheduled, executed and reconciled without an open browser.
- [ ] Outbound calling stays disabled until provider, configuration, policy and exact workflow authorization are verified.
- [ ] Consent, suppression, opt-out, calling hours, attempt limits, concurrency and spend budgets are enforced server-side.
- [ ] Duplicate/replayed webhooks cannot create duplicate calls or CRM actions.
- [ ] Human transfer/fallback, provider outage and emergency stop are tested.
- [ ] Missing/malformed Vercel configuration fails closed with safe diagnostics.
- [ ] Recording/transcription, retention, access, export and deletion are tested before those features are enabled.
- [ ] Real provider integration and end-to-end staging tests pass before production status is claimed.
