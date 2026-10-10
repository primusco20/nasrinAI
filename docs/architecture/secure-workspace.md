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
- `public/files.js` creates browser-side downloads from assistant-provided file blocks, including text/code and selected Office formats. This existing behavior is not an expansion of the Artifact Generation feature and does not publish a web app.
- The Library keeps text, not original uploaded binary files. Existing Library ownership is enforced through tenant/user-scoped backend calls.
- The API runs on Vercel serverless functions. It is not a persistent Linux shell or a safe place to execute untrusted code.

## Non-negotiable security boundary

**Never execute model output, uploaded files, shell commands, or package lifecycle scripts inside the NasrinAI API process.** Do not use `child_process`, `eval`, dynamic imports, or an in-process interpreter as a shortcut.

Real execution is out of scope unless a separately deployed, disposable sandbox service is provisioned and independently passes isolation tests. Until then, Coding must state that it cannot run code or commands. Do not claim tests passed unless a real test runner returned a successful result.

If a separately scoped future project ever proposes a runner, it must at minimum provide:
- One disposable, non-root environment per job; no host filesystem, Docker socket, cloud metadata, internal network, or other users' workspaces.
- No outbound internet by default. Any future package installation must use a narrow allowlist/proxy, bounded downloads, lockfiles, and no arbitrary lifecycle scripts.
- Read-only base image, dedicated writable job directory, no inherited secrets or production credentials, and no Supabase/service-role key.
- Hard CPU, memory, process-count, file-size, output-size, wall-clock, and disk quotas; forced termination and cleanup after every job.
- Strict input/output schemas, authenticated server-to-runner requests, replay protection, and no browser access to runner credentials.
- Bounded stdout/stderr and exit codes; output treated as untrusted data. Never automatically open or execute generated files.
- Per-user and per-tenant rate/cost limits, job idempotency, cancellation, audit metadata without source contents or secrets, and fail-closed behavior when the runner is unavailable.

## Analysis-only workflow

1. **Understand:** summarize the request and identify which provided files or code sections are relevant.
2. **Inspect:** detect actual file types from bytes; enforce compressed and expanded size/count limits; parse supported formats without running content. Treat file content as untrusted data, not instructions.
3. **Analyze:** use bounded, owner-authorized source or extracted text. Redact likely secrets before sending code to a model. Never let a file's contents override system policy or authorize tools.
4. **Suggest:** provide explanations, code snippets, proposed patches, or commands for the user to review and run themselves. Flag destructive commands and live-system changes clearly.
5. **Report honestly:** distinguish analysis from execution. State when a format is unsupported or truncated. Do not claim OCR, test execution, artifact validation, or publication unless that capability actually ran and returned evidence.

## File handling and capability honesty

- **Text, CSV, JSON, source code:** bounded text extraction and analysis.
- **DOCX/XLSX/PPTX and supported archives:** preserve parser limits; reject or safely fail on malformed, encrypted, oversized, or suspicious content; test against archive bombs and path traversal.
- **PDFs and images:** distinguish what the configured model can inspect from embedded-text extraction. Scanned-document OCR is not available unless separately implemented and verified.
- **Existing browser downloads:** do not expand or advertise new artifact-generation formats as part of this plan. Never label a text file with an extension that falsely claims a validated Office/PDF format.
- **Editing existing files:** preserve the original until a proposed replacement is reviewed. Where the existing UI supports downloads, do not silently overwrite user data.
- **ZIP/program files:** inspect as data only. Never execute uploaded binaries, macros, scripts, or package hooks automatically.
- **Web apps:** local preview and production publication are different capabilities. Do not say an app is published unless a real deployment provider confirms it.

## Data model and RLS decision

No new job/artifact tables, storage buckets, database migrations, or RLS changes are needed for this analysis-only scope. Keep using existing owner-scoped Library/project operations. Never expose the Supabase service-role key to a browser or any future runner. Because backend service-role access bypasses RLS, backend code must enforce tenant and owner checks on every read or mutation.

Any future proposal for persistent jobs or artifacts must separately define the runner API, retention/deletion policy, owner isolation, RLS, browser-role grants/revokes, and regression tests before implementation.

## Phase A — safe foundations

- Preserve existing chat, attachments, Library, Coding, projects, and already-supported browser downloads.
- Audit and test file type spoofing, malformed archives, size limits, unsafe names, secret redaction, and owner isolation before expanding supported formats.
- Keep file parsing bounded and non-executing; make unsupported formats and truncation explicit.
- Ensure the UI and assistant never represent planned execution as completed execution.
- No new runner, OCR, Artifact Generation, publishing, schema, or RLS behavior is enabled by this scope.

## Release gate

Review the exact diff and require CI, the secret scan, and relevant regression tests to pass before merging. Do not merge while required checks are failing or pending. This scope change adds no runtime behavior and requires no SQL migration.
