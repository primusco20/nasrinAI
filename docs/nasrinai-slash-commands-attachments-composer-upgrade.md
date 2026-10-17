# NasrinAI Upgrade: Slash Command Registry, Attachment Previews, and Smart Paste

**Status:** Proposed implementation specification  
**Repository:** `primusco20/nasrinAI`  
**Scope:** Product behavior, database-backed command catalog, composer UX, attachment rendering, security, and acceptance tests.

## 1. Goals

1. Make every supported NasrinAI slash command discoverable from a database-backed registry, especially coding, image/photo editing, and multi-item workflows.
2. Show previews for user attachments (images, documents, and other supported files) in the conversation after the user sends a message.
3. Allow pasted text of up to and including 2,000 characters to remain ordinary composer text. Convert pasted content into a plain-text `.txt` attachment only when the pasted content is **over 2,000 characters**.
4. Keep the experience polished, predictable, accessible, mobile-friendly, and safe.

This is a specification for implementation, not a claim that these behaviors are already live.

## 2. Database-backed slash-command registry

### 2.1 Source of truth

Create a versioned, migration-managed database table for slash commands. The database registry is the source of truth for command metadata and discoverability; it must not be a hard-coded UI-only list.

Suggested table: `public.ai_slash_commands`

| Column | Purpose |
| --- | --- |
| `id` | Stable primary key |
| `command` | Canonical command, e.g. `/blurbackground` |
| `aliases` | Optional alternate names, stored in a structured array |
| `title` | Human-readable name |
| `description` | Short, user-facing explanation |
| `category` | e.g. coding, image_editing, files, writing, research, productivity |
| `input_schema` | Validated JSON schema for supported parameters |
| `examples` | Safe example prompts/arguments |
| `required_capabilities` | Required tool/provider capabilities |
| `plan_access` | Plan/entitlement requirements, if applicable |
| `enabled` | Whether the command can be offered or executed |
| `sort_order` | Stable display ordering |
| `version` | Command definition version |
| `created_at`, `updated_at` | Audit timestamps |

Enforce a unique, normalized canonical command and prevent duplicate aliases from resolving ambiguously. Validate command names and schemas at seed/migration time. Use idempotent seed upserts so migrations can be safely re-run where supported.

### 2.2 Required implementation behavior

- Add a database migration and seed data for **all currently supported slash commands** found in the repository, existing product specification, and implemented tool capabilities. Inventory existing commands before adding new ones; do not silently drop or rename established commands.
- Include the examples below when the corresponding capability is actually supported. If a capability is not implemented or configured, mark the command unavailable with a clear reason rather than pretending it ran.
- Load the registry through a server-side, authenticated data-access layer. Cache only with a deliberate invalidation/version strategy.
- Use the same registry to power slash autocomplete, category browsing, command help, argument hints, and server-side command resolution. The client must not be the authority for permissions or execution.
- Normalize command names case-insensitively; tolerate common spelling/alias variants without executing an unintended command.
- When the user types `/`, show searchable suggestions with name, category, concise description, and relevant argument hints. Support keyboard navigation and touch-screen selection.
- Parse the selected command into a structured intent and validated arguments. Preserve the user's accompanying natural-language instructions.
- Resolve the requested action through the existing NasrinAI orchestrator and approved tools/providers. Do not create a separate foundation model per command.
- Check authentication, plan entitlement, capability availability, file ownership, and rate limits on the server before execution.
- Commands must never bypass normal safety rules, authorization, upload checks, or tool restrictions.
- Return a clear success, partial-success, unsupported, or error state. Never claim a file or edit was produced unless the operation actually completed.
- Record registry version and command identifier in internal operational metadata for traceability; do not expose internal routing, stack versions, provider secrets, raw resource names, or implementation diagnostics to end users.
- Ensure RLS and least-privilege policies are applied to any user-scoped command history or saved command data. Public command metadata may be readable through a safe view/RPC, but secrets and privileged fields must never be exposed.

### 2.3 Command catalog examples

Seed the commands below only when the underlying capability exists. This is a starter inventory, not permission to advertise nonexistent tools.

#### Photo and image editing

- `/blurbackground` — blur the background while keeping the intended subject sharp.
- `/removebackground` — remove the background where supported.
- `/changebackground` — replace the background based on a user-provided description or image.
- `/enhancephoto` — improve clarity or quality within supported editing limits.
- `/upscale` — upscale an image when an appropriate tool is available.
- `/crop` — crop to a requested region or aspect ratio.
- `/resize` — resize to specified dimensions.
- `/removeobject` — remove a selected unwanted object where supported.
- `/retouch` — perform a user-directed retouch.
- `/style` — apply a supported visual style.
- `/multiple` — apply a compatible action to multiple selected images/files, with a per-item result summary. Do not interpret this as unrestricted bulk processing.

#### Coding and repository work

- `/explaincode` — explain selected or attached code.
- `/debug` — investigate an error using the provided context and evidence.
- `/fixcode` — propose or apply an authorized code fix through available tools.
- `/refactor` — refactor while preserving intended behavior.
- `/reviewcode` — review for correctness, security, performance, and maintainability.
- `/writeTests` — create relevant tests for the supplied code/change.
- `/runTests` — run tests only when an execution environment is available; report actual results.
- `/screenshot` — capture a screenshot only when the browser/rendering capability is available.
- `/inspectrepo` — inspect the authorized repository and summarize evidence-based findings.
- `/createPR` — prepare a pull request only when repository authorization and GitHub tooling are available; do not merge without explicit authorization.

#### Files and productivity

- `/summarize` — summarize selected text or supported attachments.
- `/extracttext` — extract text from supported files/images.
- `/convert` — convert between explicitly supported file formats.
- `/compare` — compare selected files or text.
- `/translate` — translate selected text.
- `/rewrite` — rewrite selected text to the requested tone or format.

For every command, define accepted inputs, output type, capability dependencies, failure modes, entitlement rules, and at least one test. Do not create placeholder commands that imply unsupported execution.

## 3. Attachment previews after sending

### 3.1 Required behavior

After a message is sent, render its attached files as persistent attachment cards/previews in the conversation message—not only in the composer.

- **Images:** show a thumbnail preview with sensible aspect-ratio handling; allow opening a larger preview/lightbox where supported.
- **PDFs and supported documents:** show a file-type icon, filename, size, and an embedded or expandable preview when the viewer supports that format.
- **Audio/video:** show a suitable media preview/player only for supported formats and only when playback is available.
- **Other files:** show a clear file card with type, name, size, upload state, and a download/open action if supported.
- Show attachment previews for both user and assistant messages when their message includes generated or returned files.
- Keep the preview attached to the correct message across reloads and conversation history. Persist stable storage/object identifiers and safe metadata, not short-lived signed URLs as the only reference.
- Show upload, processing, success, and failure states accurately. If an upload or preview fails, retain a useful retry/remove action where possible.
- On mobile, previews must fit the viewport, remain touch-friendly, and not cause horizontal scrolling.
- Support multiple attachments in one message with a responsive grid/list, deterministic ordering, and per-file status.
- Revoke temporary object URLs when no longer needed. Lazy-load large previews and avoid downloading full-resolution assets just to render thumbnails.

### 3.2 Security and privacy

- Validate MIME type and file signature where feasible; never trust the client-supplied filename or MIME type alone.
- Enforce file-size limits, upload authorization, ownership checks, and supported-format allowlists on the server.
- Escape filenames and metadata before rendering. Never render arbitrary uploaded HTML or execute active document content in the application origin.
- Use signed URLs or authenticated download endpoints with appropriate expiry. Do not expose service-role credentials or unrestricted storage paths.
- Apply the existing retention/deletion policy and ensure deleted attachments no longer appear as valid previews.
- Respect RLS and the existing storage access model. Preview authorization must be checked independently of whether a message is visible.

## 4. Smart paste threshold: 2,000 characters

### 4.1 Exact threshold

- **0–2,000 characters inclusive:** paste into the composer as ordinary editable message text. Do not create a file.
- **2,001 characters or more:** convert the pasted text into a plain-text `.txt` attachment, and show the resulting file card in the composer before sending.
- Count the actual pasted text using a documented, consistent Unicode-aware rule. Prefer Unicode code points for user-perceived text counting where practical; do not count HTML markup used only for clipboard formatting. Normalize clipboard rich text to safe plain text for this rule.
- Apply the threshold to each paste event, not to all existing composer text. A paste under the threshold must not unexpectedly convert previously typed content into a file.
- Preserve the pasted text faithfully, including line breaks and Unicode characters. Avoid silent truncation.
- Use a safe, predictable filename such as `pasted-text.txt`; resolve duplicate names without overwriting another attachment.
- Do not upload/create the file until the user confirms sending, unless the current upload architecture requires an explicit staged upload. If staged, clean up abandoned temporary uploads.
- The generated `.txt` file must use UTF-8 and a plain-text MIME type. Display its name and size, allow preview/removal before sending, and persist it with the message once sent.
- If file creation/upload fails, keep the pasted text recoverable and explain how the user can retry or send it as text. Never discard user content silently.
- Normal typing, drag-and-drop attachments, explicit file uploads, and image pastes must continue to work. The 2,000-character conversion rule is specifically for pasted **text**, not images or files.
- Ensure the behavior works on Safari for iPhone/iPad as well as desktop browsers, including clipboard events and mobile paste menus.

### 4.2 Composer UX

- Keep the composer responsive and accessible; show an unobtrusive file chip/card for converted text.
- If pasted content exceeds the threshold, provide a concise explanation such as: “Long paste attached as pasted-text.txt (2,438 characters).”
- Let the user preview, remove, or replace the generated attachment before sending.
- Keep ordinary short pasted text editable in place. Do not silently transform a short paste into a file.
- Ensure keyboard and screen-reader users receive a clear announcement when conversion occurs.

## 5. Message and command persistence

- Persist the message body, attachment references, and command invocation metadata in a transactionally consistent manner where feasible.
- Keep the user-visible conversation content separate from internal execution traces and provider/tool diagnostics.
- Apply the product's configured filtering/redaction policy before storing generated replies or operational events. Never persist API keys, access tokens, credentials, or unfiltered sensitive diagnostics in conversation content or logs.
- Define and test retention, deletion, export, and access-control behavior for command history and attachment metadata.
- Avoid duplicating large attachment bytes in message rows; store files in the approved object storage and keep stable references plus safe metadata in the database.

## 6. Suggested implementation sequence

1. **Inventory:** inspect existing slash commands, composer paste handlers, attachment components, message schema, storage buckets, RLS policies, and test conventions. Reuse existing patterns.
2. **Database:** add a reversible/versioned migration for the command registry, constraints/indexes, least-privilege access, and idempotent seeds.
3. **Command service:** implement server-side lookup, validation, authorization, capability resolution, and structured error responses.
4. **Autocomplete and execution:** connect composer slash suggestions to the database registry and existing orchestrator.
5. **Attachment persistence/previews:** ensure sent messages retain attachment references and render previews from authorized storage.
6. **Smart paste:** implement the exact 2,000/2,001 boundary and UTF-8 text-file flow, including cleanup on cancel/failure.
7. **QA and release:** run migrations in the intended environment, test mobile Safari and desktop, inspect security/RLS, and verify the live behavior only after deployment.

Do not combine unrelated production changes or bypass the repository's existing review/deployment process.

## 7. Acceptance tests

### Slash-command registry
- Migration creates the registry and seed migration is idempotent.
- Every existing supported command remains available with the same documented behavior.
- `/blurbackground` and `/multiple` appear in suggestions only when the corresponding capability is enabled.
- Alias collisions, unknown commands, malformed arguments, disabled commands, and unauthorized plan/tool access fail safely.
- User-facing errors are concise and do not expose stack traces, provider names/secrets, internal resource identifiers, or infrastructure details.
- Registry access is protected by the intended database permissions and RLS policies.

### Attachment previews
- A sent image remains previewable after refresh and when reopening the conversation.
- Multiple attachments render in the correct message and order.
- Supported PDFs/documents show a safe preview or a clear fallback file card.
- Unsupported or failed uploads show an accurate failure state without broken or misleading previews.
- Unauthorized users cannot preview or download another user's files by guessing an identifier or URL.
- Mobile layouts work without horizontal overflow.

### Smart paste boundary
- Paste exactly 2,000 characters: remains editable composer text; no `.txt` file is created.
- Paste exactly 2,001 characters: produces a UTF-8 `.txt` attachment preview.
- Test empty text, multiline text, emoji/non-Latin text, rich-text clipboard content, repeated pastes, and existing text in the composer.
- Pasting an image/file does not trigger text conversion.
- Cancel/remove and upload failure do not lose the user's text.
- Verify on Safari iOS and at least one desktop browser.

### Quality gates
- Add unit tests for command normalization, schema validation, threshold counting, and filename handling.
- Add integration tests for database access/RLS, message-plus-attachment persistence, and authorized preview retrieval.
- Add UI tests for autocomplete, preview persistence, and the 2,000/2,001-character boundary.
- Run the existing full test suite and report the actual results. Do not claim tests passed unless they were run.
- Update relevant product/architecture documentation if implementation changes established behavior.
