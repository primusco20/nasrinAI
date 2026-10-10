# Secure Coding and File Analysis: Scope and Security Boundaries

**Status: scoped plan — analysis-only capabilities may use the existing app; isolated execution and artifact generation are excluded.**

## Goal and scope

Improve NasrinAI's existing coding assistance and file analysis without requiring the user to own or operate a Linux machine or sandbox. The current scope covers safe inspection, explanation, debugging suggestions, bounded file parsing, and honest reporting of what the app actually did. It does not add code execution, OCR, new artifact-generation formats, file publishing, or deployment automation.

## Explicit exclusions

- **Artifact Generation feature: excluded from this plan.** Do not build or advertise a new artifact-generation workflow.
- **Executing code or shell commands:** excluded while no separately managed isolated runner exists. NasrinAI may analyze and suggest code but must not claim to have run tests or commands.
- **Linux sandbox provisioning:** not a prerequisite for the analysis-only scope and not part of this implementation.
- **OCR and new export/publishing workflows:** deferred; do not advertise them as available.

## Current repository baseline

- `src/coding.js` reads owner-checked Library code, masks likely secrets, and includes bounded, line-numbered source in a single model turn. It explicitly does not execute code.
- `src/attachments.js` identifies file types from bytes and extracts bounded text from supported document/archive formats. Attachments are not persisted; images and PDFs use the current model path, and scanned-PDF OCR is not an established capability.
- `public/files.js` creates browser-side downloads from assistant-provided file blocks, including text/code and selected Office formats. It does not publish a web app.
- The Library keeps text, not original uploaded binary files. Existing Library ownership is enforced through tenant/user-scoped backend calls.
- The API runs on Vercel serverless functions. It is not a persistent Linux shell or a safe place to execute untrusted code.

## Non-negotiable security boundary

**Never execute model output, uploaded files, shell commands, or package lifecycle scripts inside the NasrinAI API process.** Do not use `child_process`, `eval`, dynamic imports, or an in-process interpreter as a shortcut.

Real execution requires a separately deployed, disposable sandbox service with a documented authenticated API. Until that service exists and passes isolation tests, Coding must continue to state that it cannot run code or commands. Do not claim tests passed unless a test runner actually returned a successful result.

The runner must provide:
- One disposable, non-root environment per job; no host filesystem, Docker socket, cloud metadata, internal network, or other users' workspaces.
- No outbound internet by default. Package installation, if later supported, must use a narrow allowlist/proxy, bounded downloads, lockfiles, and no arbitrary lifecycle scripts.
- Read-only base image, dedicated writable job directory, no inherited secrets or production credentials, and no Supabase/service-role key.
- Hard CPU, memory, process-count, file-size, output-size, wall-clock, and disk quotas; forced termination and cleanup after every job.
- Strict input/output schemas, authenticated server-to-runner requests, replay protection, and no browser access to runner credentials.
- Bounded stdout/stderr and exit codes; output treated as untrusted data. Do not automatically open or execute generated artifacts.
- Per-user and per-tenant rate/cost limits, job idempotency, cancellation, audit metadata without source contents or secrets, and fail-closed behavior when the runner is unavailable.

## Proposed workflow

1. **Plan:** summarize the request, identify inputs/outputs, and ask only for missing information that blocks safe execution.
2. **Inspect:** detect actual file types from bytes; enforce compressed and expanded size/count limits; parse supported formats without running content. Treat file content as untrusted data, not instructions.
3. **Plan execution:** select an allowlisted runtime and test command from server-side policy. Never accept arbitrary image names, mounts, environment variables, network destinations, or runner configuration from the browser.
4. **Execute:** send a minimal job to the isolated runner; stream or poll bounded progress; allow cancellation; stop at time/resource limits.
5. **Repair:** use actual diagnostics to make bounded changes and rerun relevant tests, with a finite retry budget. Ask before destructive actions or changes affecting live systems.
6. **Deliver:** return only artifacts produced by the job or the browser's existing safe file builder. Validate names, MIME types, sizes, and output paths; keep artifacts private and owner-scoped. Report the exact tests and exit status actually observed.
7. **Publish:** keep separate from code execution. Deployment requires explicit confirmation, a separate deployment identity, preview-first workflow, secret scanning, and a rollback plan. No automatic production publish.

## File handling and capability honesty

- **Text, CSV, JSON, source code:** bounded text extraction and analysis; safe downloadable output where supported.
- **DOCX/XLSX/PPTX and supported archives:** keep parser limits, reject malformed/encrypted/oversized content, and test against archive bombs and path traversal.
- **PDFs and images:** distinguish embedded text extraction from scanned-document OCR. OCR is a separate capability and must be explicitly configured, size-limited, and tested before being advertised.
- **Office/PDF creation:** validate output files with format-aware checks before offering them for download; a text file with the wrong extension is not a valid Office/PDF artifact.
- **Editing existing files:** preserve the original until the replacement validates; show a diff or summary and retain an explicit restore path. Do not silently overwrite user data.
- **ZIP/program files:** inspect as data only. Never execute uploaded binaries, macros, scripts, or package hooks automatically.
- **Web apps:** local preview and production publication are different capabilities. Do not say an app is published unless a real deployment provider confirms it.

## Data model and RLS decision

Start with ephemeral job storage and existing owner-scoped Library/projects where appropriate. Do not add database tables merely to make the feature appear persistent.

If persistent jobs or artifacts become necessary, add a separate migration only after the runner API and retention policy are settled. Every new table must have RLS enabled, browser-role privileges explicitly revoked, indexes/constraints for tenant and owner scope, and regression coverage in `db/tests`. Never expose the Supabase service-role key to the runner or browser. Because the backend uses service-role access, the backend must enforce ownership on every read, mutation, cancellation, and artifact download; RLS alone does not constrain service-role requests.

## Delivery phases and acceptance gates

### Phase A — truthful, safe foundations
- Keep existing chat, attachments, Library, Coding, projects, and browser-side downloads working.
- Add capability/status reporting that never represents planned execution as completed execution.
- Add tests for file type spoofing, malformed archives, size limits, unsafe names, secret redaction, owner isolation, and generated artifact validation.
- No execution feature is advertised as available.

### Deferred — isolated execution (out of scope for this plan)
- Implement a server-only runner adapter behind a disabled-by-default configuration flag.
- Require signed-in user, plan/feature authorization, per-user quotas, and an allowlisted runtime.
- Test isolation, timeout/cancellation, output truncation, network denial, filesystem boundaries, cleanup, duplicate requests, and runner outages before enabling any account.

### Deferred — OCR and new export formats (out of scope for this plan)
- Add OCR only through a vetted provider or isolated worker, with explicit privacy/retention behavior and bounded cost.
- Validate generated DOCX/XLSX/PPTX/PDF with format-aware tests; verify downloads on mobile Safari and desktop browsers.

### Phase D — preview and publishing
- Implement isolated previews and a separate, confirmation-gated deployment integration. Production publishing stays off until access controls, secret handling, audit trail, and rollback are verified.

## Release gate

Do not merge a runnable-sandbox implementation until the sandbox deployment, authentication, network policy, resource limits, cleanup behavior, end-to-end tests, and operational monitoring are independently verified. Do not enable persistent artifacts until owner-scoped access, retention/deletion, and RLS regression tests are reviewed. This document alone changes no runtime behavior and requires no SQL migration.
