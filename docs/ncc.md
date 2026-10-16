# NCC — Nasrin Client Connect

Owner request (2026-10-13): add NCC to NasrinAI Space. NCC is a CRM with
automation, in the spirit of GoHighLevel (contacts, pipelines,
conversations, follow-ups) and n8n (visual workflows: trigger → steps).

**Status:** built, off by default: NCC is its own app at
**ncc.nasrinai.com** with contacts, pipeline, tasks, timelines,
automations, and the business's own Meta channels (Facebook Page,
Instagram, Threads posts; WhatsApp messages) with an approval outbox.
Messenger is not built yet (it needs the Messenger inbox).

**Owner decisions (2026-10-13):**

- NCC is **separate from Connect**.
- It is **for enterprises**, not self-serve: businesses **contact the team**.
  The tile says so, says it is not live yet, and links to
  `support@nasrinai.com` with the subject "NCC (Nasrin Client Connect)
  enterprise enquiry". `[REQUIRES INPUT]`: a dedicated sales address, if
  there is one.
- **Logo:** three triangles. The owner chose **B · Flow**: three rounded
  right-pointing triangles in a row, fading in (automations running step by
  step). Drawn originally for NasrinAI; it stays clear of the Triforce, Citgo,
  Mitsubishi and Google Drive marks. A formal trademark search (IPOPHL, WIPO
  Global Brand Database) is still advised before registration. File:
  `public/space-logos/ncc-logo-flow.svg`; inline on the Space tile.

**Owner decisions (2026-10-13, for N1):**

- **Access:** team-enabled only. NCC works for an account only when
  `NCC_ENABLED=true` and the account's sign-in email is listed in
  `NCC_ACCOUNTS` (comma-separated). Everyone else sees the
  "contact the team" message on the tile.
- **Keep-time:** contacts and deals are kept until the business deletes them,
  or deletes its NasrinAI account.
- **Social channels:** Facebook Pages, Instagram, Messenger, Threads and
  WhatsApp, all through Meta's official APIs. Built: all but Messenger.

- **Separate app (owner, 2026-10-13):** NCC lives at `ncc.nasrinai.com`,
  desktop-friendly and iPhone-friendly, a full CRM with automation.

## What is built

**The app** (`public/ncc/`: `index.html`, `ncc.css`, `ncc.js`,
`automations.js`, icons, manifest):

- Served at `/ncc/`. On `ncc.nasrinai.com` the root redirects to `/ncc/`
  (`vercel.json` redirect with a host condition; the same rule in
  `src/http/app.js` for local runs).
- Same NasrinAI accounts: email code or Google (Turnstile when on). Google
  sign-in started on the NCC address comes back there (`NCC_URL`).
  Accounts that are not turned on see "NCC is for businesses" and a
  contact link.
- **Desktop:** sidebar, contacts table, drag-and-drop pipeline, side panel
  for details and forms.
- **iPhone:** tab bar above the home indicator (safe areas), large titles,
  bottom sheets, 16 px fields (no zoom), 44 px touch targets, Add to Home
  Screen (apple-touch-icon, manifest).
- **Home:** contacts, open deals, won this month, tasks due; pipeline bars;
  up next; recent contacts.
- **Contacts:** search, tag filters, profile with Email/Call, deals, tasks
  and a timeline (notes and what happened).
- **Pipeline:** Lead, Qualified, Proposal, Won, Lost, with totals.
- **Tasks:** due dates, overdue/today/upcoming, done.
- **Automations:** When → If → Then editor with ready-made templates.
- **Settings:** import CSV/Excel (read on the device), export CSV/JSON,
  delete all, account.
- No HTML is built from data; only our own `/v1` API is called.

**Automations** (`src/ncc-automations.js`, runner in `src/ncc.js`):

- **When:** a contact is added; a tag is added; a deal is added; a deal
  moves to a stage; a task is completed.
- **If (all must match):** tags has/doesn't have, company, email, phone,
  how it was added, deal value at least/at most, deal stage.
- **Then (1–10 steps):** add/remove tag, create a task (due in N days), add
  a note, add a deal, move the deal. Texts may use `{{contact.first_name}}`,
  `{{contact.name}}`, `{{contact.company}}`, `{{deal.title}}`,
  `{{deal.value}}`.
- **Safety:** the server checks every part against fixed lists. An
  automation's own changes start others only to depth 2, at most 25 steps
  per request, so nothing loops. A failing step stops that automation and
  is recorded; it never fails the person's change. Imports never start
  automations. The AI cannot create or run automations. Each run is shown
  on the automation (runs, last result) and on the contact's timeline.
- **Social steps:** post on the Facebook Page, Instagram (needs a public
  picture link) or Threads; send a WhatsApp template or plain text to the
  contact (international number). Each step waits in the **outbox** for the
  business to tap Send, unless the business switched on "Send by itself"
  for that exact step. At most 5 sends per request.

**Meta channels** (`src/ncc-meta.js`, official APIs only):

- Connect by pasting a token from Meta: a **Page access token** (connects the
  Page and its linked Instagram professional account), a **Threads** token,
  or a **WhatsApp** phone number ID with a system-user token. The server
  checks it with Meta, seals it (AES-256-GCM, `CONNECTOR_SECRET_KEY`, bound
  to the account and channel) and never returns it.
- Calls: Page `POST /{page-id}/feed`; Instagram `POST /{ig-user-id}/media`
  then `/media_publish`; Threads `POST graph.threads.net/v1.0/{id}/threads`
  then `/threads_publish`; WhatsApp `POST /{phone-number-id}/messages`.
  `FACEBOOK_GRAPH_VERSION` sets the Graph version.
- Meta errors become plain reasons (expired connection, permission not
  approved, rate limit, outside WhatsApp's 24-hour window, unknown
  template). Tokens and message text are never logged.
- The **outbox** (`ncc_outbox`): pending → sending (claimed once, so never
  sent twice) → sent/failed, or discarded. The Social screen shows what
  waits for approval, the channels, a "New post" composer (the person's tap
  is the approval) and recent results. Contacts with a phone get a
  WhatsApp button.
- Meta's own rules still apply: each permission needs Meta's app review
  (`pages_manage_posts`, `instagram_content_publish`,
  `threads_content_publish`, `whatsapp_business_messaging`); WhatsApp plain
  text only within 24 hours of the customer's last message, otherwise an
  approved template.

**Data:** migration `040_ncc.sql`: `ncc_contacts`, `ncc_deals`,
`ncc_tasks`, `ncc_activities`, `ncc_automations`; migration
`041_ncc_channels.sql`: `ncc_channels` (sealed tokens only), `ncc_outbox`.
Both only create new tables. Before 041 is run the CRM works and Social
says channels are not ready; account deletion skips NCC tables that are not
there yet. RLS on, browser roles
denied, server only. Deleting a contact deletes its deals, tasks and
timeline. DB test `db/tests/040_ncc.test.sql`.

**Server:** `src/ncc.js`. Every request: signed in, `NCC_ENABLED=true`,
the verified sign-in email in `NCC_ACCOUNTS`; every query filtered by
tenant AND user id. Limits `NCC_CONTACTS_MAX`, `NCC_DEALS_MAX`,
`LIMIT_USER_NCC_HOUR`, 5000 tasks, 50 automations.

**API:** `GET /v1/ncc/status`, `GET /v1/ncc`; contacts `POST /v1/ncc/contacts`,
`POST /v1/ncc/contacts/import`, `PUT|DELETE /v1/ncc/contacts/:id`,
`GET /v1/ncc/contacts/:id/timeline`, `POST /v1/ncc/contacts/:id/notes`;
deals `POST /v1/ncc/deals`, `PUT|DELETE /v1/ncc/deals/:id`; tasks
`POST /v1/ncc/tasks`, `PUT|DELETE /v1/ncc/tasks/:id`; automations
`POST /v1/ncc/automations`, `PUT|DELETE /v1/ncc/automations/:id`;
channels `POST /v1/ncc/channels`, `DELETE /v1/ncc/channels/:id`; posting
`POST /v1/ncc/posts`, `POST /v1/ncc/contacts/:id/whatsapp`; outbox
`POST /v1/ncc/outbox/:id/send`, `POST /v1/ncc/outbox/:id/discard`;
`GET /v1/ncc/export`, `POST /v1/ncc/delete-all` (`{ "confirm": "DELETE" }`).

**Main app:** the NCC tile in NasrinAI Space shows "Open NCC" for enabled
accounts, otherwise the contact-the-team message. Account export and
deletion include NCC.

**Privacy Notice 2026-10-13f** describes NCC records (business as
controller, NasrinAI as processor, kept until deleted). The enterprise and
data processing agreement is `[REQUIRES INPUT]`.

**Owner steps:**

1. Supabase (staging first, then production): run `040_ncc.sql`, then
   `041_ncc_channels.sql`.
2. Vercel → Project → Settings → Domains: add `ncc.nasrinai.com`, then add
   the DNS record Vercel shows at your domain provider.
3. Vercel → Environment Variables: `NCC_ENABLED=true`,
   `NCC_ACCOUNTS=business1@email.com,business2@email.com`.
4. Supabase → Authentication → URL Configuration → Redirect URLs: add
   `https://ncc.nasrinai.com/v1/auth/google/callback`.
5. Cloudflare Turnstile (if used): add `ncc.nasrinai.com` to the widget's
   hostnames.
6. For channels: Vercel `CONNECTOR_SECRET_KEY` must be set (64 hex
   characters, already used by connectors). In the Meta app, request app
   review for the permissions above; until approved, only accounts with a
   role on the Meta app can post.

## What NCC will be

| Part | What the business owner gets |
|---|---|
| Contacts | People and companies, tags, notes, custom fields, import from CSV (reusing the messy-file cleaner), duplicate check |
| Pipeline | Stages (Lead → Qualified → Proposal → Won/Lost), deals with value and owner, a board view |
| Inbox | One thread per contact, from the channels already in NasrinAI (Messenger via Connect, website chat via SmartChat), later email |
| Tasks & follow-ups | Due dates, reminders, "no reply in 3 days" lists |
| Automations | Workflows of **trigger → conditions → actions** (new lead, stage changed, form sent, no reply after N days → tag, move stage, create task, send a drafted message), built in a simple step editor |
| AI help | Nasrin drafts replies, summarizes a contact's history and suggests the next step. It never sends by itself (see rules) |
| Reports | Leads per source, conversion per stage, response time |

## Rules it must follow (from CLAUDE.md and docs/automation)

- **Tenant-scoped, server-side only:** every table has RLS with server-only
  access, every query is checked for owner and tenant, and the browser is
  never trusted.
- **The AI is untrusted:**
  - it drafts, but anything that sends, posts, books or changes a record
    needs the owner's **Confirm**;
  - an automation runs an outward action only when the owner has turned that
    exact action on for that workflow (the existing
    `src/automation/policy.js` fail-closed policy).
- **Customer data:** businesses' contacts are their customers' personal
  data, so NasrinAI becomes their *processor*. This needs:
  - Terms and Privacy updates, likely a data processing addendum;
  - export and delete per business;
  - a keep-time;
  - no training on customer data.
  - These are owner decisions (`[REQUIRES INPUT]`).
- **Official APIs only** for outside channels; provider tokens sealed with
  `CONNECTOR_SECRET_KEY`.
- **No new runtime packages** (ADR-002). The workflow editor is plain
  JS/CSS like the rest of the app.

## Proposed phases (one PR each, staging first)

1. **N1 Contacts & pipeline:** migration with tables and DB tests, API,
   screens. No automation.
2. **N2 Tasks & inbox:** threads from Connect (Messenger and website chat)
   attached to contacts.
3. **N3 Automations:** the step editor plus a runner (Vercel cron), using the
   existing automation policy. Internal actions only: tag, stage, task.
4. **N4 Outward actions:** send messages and emails only after Confirm or an
   explicit per-workflow allowance, with audit and undo where possible.
5. **N5 AI help & reports.**

## Still needed from the owner

- Enterprise terms: contract and price after a business contacts the team,
  and the data processing agreement (`[REQUIRES INPUT]`).
- Meta app review for N4 (Pages, Instagram, Messenger, Threads, WhatsApp
  permissions).
- Run migrations on a staging Supabase first (required by CLAUDE.md).


## NCC Upgrade: visual AI-agent workflow canvas

The planned NCC automation experience is a connected, node-based canvas inspired by the reference workflow shared by the owner. This extends the existing **When → If → Then** automation editor toward a full visual workflow builder. This is a target architecture, not a claim that the advanced canvas is already implemented.

### Canvas and nodes

- **Trigger nodes:** manual run, form submission, webhook, schedule, supported CRM events, and calls from another workflow.
- **AI Agent node:** accepts task/context and produces structured output. It has separate typed connections for **Chat Model**, **Memory**, and **Tool**.
- **Logic nodes:** IF/Switch, filters, merge, loops, wait, deduplication, and named success/error branches.
- **Action nodes:** CRM contacts/deals/tasks, approved notifications, and registered external connector actions.
- **Data nodes:** field mapping, validation, JSON parsing, transformation and aggregation.
- **Reliability nodes:** approval gate, retry, error handler, checkpoint, notification and reusable sub-workflow.

Users should be able to drag nodes onto a canvas, connect compatible input/output ports, configure nodes in a side panel, validate the graph, test with sample input, save drafts, publish immutable versions, compare changes, and inspect each node's run status, duration, sanitized input/output and errors. Provide a list/step editing mode for mobile and accessibility; drag-and-drop must not be the only way to edit on iPhone.

### AI Agent: Chat Model, Memory and Tools

- **Chat Model:** references an available NasrinAI model/provider configuration. Credentials stay server-side and never appear in workflow definitions or model context.
- **Memory:** optional, tenant-scoped context with explicit retention and data minimization. Memory is not authorization. Do not train on business customer data by default.
- **Tools:** the agent can choose only among tools explicitly connected to the Agent node, registered by NCC and authorized for the current tenant/workflow. Every invocation is validated and permission-checked server-side.
- **Structured results:** the Agent should return validated fields so downstream IF/Switch nodes can branch on values such as `is_manager`, `user_exists` or `needs_approval`, rather than parse free-form prose.
- **Budgets:** bound tool-call count, agent iterations, runtime, output size and token/cost use; detect repeated calls and workflow recursion.
- **Approval:** external or consequential actions pause for the required human approval. An agent cannot approve its own actions or grant itself new permissions.

### Example workflow

```text
[Create User Form / Webhook]
            |
            v
 [AI Agent: Provision User]
    |          |          |
    |          |          +-- Tool --> [Directory: Find User]
    |          +------------- Memory -> [Tenant-scoped Memory]
    +------------------------ Model --> [Configured NasrinAI Model]
            |
            v
      [IF: Is Manager?]
         /        \
      true        false
       |             |
       v             v
 [Slack: Invite] [Directory/Jira: Update Profile]
         \          /
          v        v
       [Record Result / Notify]
```

This example illustrates the intended pattern only. A node is executable only when its connector and exact operation exist, its credentials and permissions are valid, and required approvals are satisfied. Do not show Slack, directory, Jira or other integrations as available merely because they appear in a template.

### Universal integration model

NCC should orchestrate all capabilities exposed by registered and authorized nodes—not provide unrestricted access to every service or machine. Support native connectors, a secured HTTP/API node, verified webhook send/receive, reusable sub-workflows, and sandboxed custom code only when an isolated runtime has been reviewed and enabled. Shell access remains disabled by default. Apply SSRF and egress protections, secret isolation, per-tenant permissions, rate/resource budgets and audit logging.

Unknown integrations must be marked unavailable or saved as draft configuration; never silently skip a missing node or claim an external action succeeded without verified evidence. Keep deterministic logic in regular nodes and use AI only when reasoning is useful.

### Execution and release requirements

1. Published workflows are immutable and every execution pins a workflow/node version.
2. Separate workflow design/control APIs from durable background execution; do not rely on a Vercel request handler to run long workflows indefinitely.
3. Persist run and per-node states, support safe retries/cancellation/recovery, and use idempotency/reconciliation to avoid duplicate external side effects.
4. Show the actual executed path, branch decisions, errors and approval state in the run inspector.
5. Draft edits cannot change an active published version; publishing validates the graph and shows a diff.
6. Tenant ownership and permissions are checked server-side on every workflow, run, connection, tool and approval operation.
7. Test worker restart, duplicate events, invalid node schemas, missing credentials, provider timeouts, cross-tenant access and approval bypass attempts.
8. Keep implementation status accurate. The existing simple automation editor and runner remain the current baseline until the advanced canvas and runtime are implemented and verified.

See also `docs/ncc-upgrade.md` for the full architecture, implementation phases and production acceptance checklist.
