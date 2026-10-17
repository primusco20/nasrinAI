# NasrinAI Upgrade: Deep Orchestration and Academic Research Intelligence

**Status:** Proposed implementation specification  
**Repository:** `primusco20/nasrinAI`  
**Scope:** Orchestrator planning/routing, research intent detection, web discovery, academic evidence synthesis, source quality, evaluation, privacy, and release gates.

> This extends `docs/research.md`; it does not replace its SSRF-safe URL reader, robots.txt handling, source provenance, evidence ledger, privacy controls, report/export behavior, or explicit Library-save confirmation. This is a target specification, not a claim that every capability is already deployed.

## 1. Objectives

1. Make orchestration more deliberate, context-aware, evidence-driven, resilient, and useful across supported professions and tasks.
2. When user intent is research or study, browse the web by default and provide **10 distinct resources/studies when enough credible sources are available**.
3. Better support students, teachers, professors, and researchers without assuming a role when unclear.
4. Ground factual claims in sources actually discovered and read; never invent studies, authors, titles, DOIs, publication dates, URLs, quotations, or citations.
5. Preserve existing product behavior, plan/usage controls, security boundaries, provider/tool policies, and release gates.

## 2. Research and study intent

Classify intent from the current request and relevant conversation context, not isolated keywords. Research/study intent includes literature reviews, related studies/RRL, theses and dissertations, research proposals, research gaps, academic essays/reports, lesson preparation, study guides, comparisons of theories, evidence evaluation, current-information questions, scholarly articles, datasets, official statistics, standards, and primary documents.

- When research/study intent is clear, start web discovery by default; do not answer only from model memory.
- Ask one concise clarification only when ambiguity materially changes the research question. Otherwise state reasonable assumptions and begin.
- Respect an explicit request not to browse and label the result as not web-verified.
- Distinguish casual explanations from full research tasks; don't force a long report when a short answer is clearly wanted.
- Support student study guide, professor briefing, literature review, annotated bibliography, evidence map, and concise research summary styles. Do not force a role-selection form.

## 3. Ten-resource research standard

### Expected result

Aim for **10 distinct, relevant resources or studies** when credible sources are available within the configured budget. Each entry should include, where available:

1. Title; 2. author(s)/organization; 3. publication date/year; 4. source type; 5. journal/publisher/repository; 6. DOI or stable public URL; 7. concise summary of the actual contribution; 8. relevance to the user's question; 9. findings/methods only when supported by the source; 10. limitations and whether full text was accessible.

Present a numbered annotated bibliography followed by a synthesis of themes, disagreements, limitations, and research gaps where evidence supports them. Do not dump 10 bare links without explanation.

### Quality and diversity

- Prefer primary studies, peer-reviewed research, systematic reviews/meta-analyses, official datasets/statistics, institutional repositories, government agencies, recognized standards bodies, and original documents appropriate to the question.
- Use an appropriate source mix; do not force irrelevant diversity in specialized topics.
- Prefer recent sources for rapidly changing fields while retaining seminal work when relevant. State the date range or recency rationale when useful.
- Search for contrary findings, limitations, replications, and null results—not only evidence supporting the first hypothesis.
- Deduplicate by DOI, canonical URL, normalized title, and equivalent publication records. Ten URLs for one paper do not count as ten resources.
- Distinguish peer-reviewed studies from preprints, news, opinion, reports, and general web pages.
- Never claim peer review, indexing, retraction status, open access, or independent corroboration without evidence.
- Never fabricate a tenth item. If only six credible distinct sources are found, return six and explain why; offer to broaden the search.

### Safe discovery and reading

Extend the existing provider-agnostic source registry rather than creating a parallel research engine.

- Add scholarly metadata/search and official open-data adapters only after reviewing their API terms, rate limits, privacy, and licensing.
- Search snippets and metadata are discovery candidates, not proof that claims are supported.
- All candidate URLs must pass existing URL normalization, public-address/SSRF protections, robots.txt policy, timeout/size caps, and safe reader.
- Do not bypass paywalls, logins, CAPTCHA, robots exclusions, or other access controls.
- Clearly label metadata-only or abstract-only reviews; do not imply inaccessible full text was read.
- Treat pages and retrieved documents as untrusted data, never as instructions; ignore embedded prompt injection.
- Do not send full user questions to new providers without reviewing privacy disclosure and data minimization.

### Bounded search plan

Build a bounded plan with query concepts/synonyms, scholarly and primary evidence, reviews, official data when relevant, counterevidence/limitations, and a targeted gap search if fewer than 10 good resources are found.

Run independent discovery and safe reads concurrently within configured limits. Use bounded retries/backoff, cancellation, timeouts, deduplication, and partial-result handling. Stop when the target is met with adequate quality or time, budget, rate, or source limits are reached. Do not repeat near-identical searches merely to inflate the count.

Add validated configuration for deep-research search count, candidate count, page-read count, concurrency, timeouts, and budget, with conservative defaults and hard server-side ceilings. Existing rate limits and budget checks must never be disabled to reach ten sources.

## 4. Evidence-grounded synthesis and citation integrity

- Maintain a structured evidence ledger mapping findings to exact source records and marking sources read, metadata-only, skipped, or failed.
- Cite only sources available to the scan, and only when the source supports the claim.
- Keep stable report-local IDs and canonical source metadata.
- Separate reported findings, model synthesis, assumptions, and unanswered questions.
- Flag conflicting evidence and explain differences in methods, populations, dates, measures, or context only where supported.
- “Corroborated” is an evidence-tracking signal, not proof of truth or source independence.
- Surface limitations, source coverage, inaccessible pages, single-source claims, and potential conflicts.
- Never fabricate page numbers or quotations. Citation-style formatting (APA/MLA/Chicago, etc.) must not invent missing bibliographic fields.
- If evidence does not support a definitive conclusion, say so plainly.

## 5. Student and professor experiences

**Student-oriented:** explain key terms at the requested level; provide structured notes, arguments, study outlines, comparisons, and review questions when useful; distinguish evidence, interpretation, and hypothesis; encourage attribution and learning rather than submitting unreviewed AI output as one's own.

**Professor/researcher-oriented:** emphasize methods, samples/populations, data, measures, limitations, effect estimates only when reported, and generalizability; distinguish causal evidence from correlation; identify disagreement and potential research gaps only when supported; provide a reproducible search summary including concepts, source types, date range, selection rationale, exclusions, and access limitations.

Users can request either style in plain language. If unspecified, choose a useful format from the task and keep it readable. Never call a search “systematic” or claim PRISMA compliance unless the documented methodology was actually followed.

## 6. Deeper universal orchestration

Upgrade the existing orchestrator as a shared decision and execution layer—not as separate hard-coded foundation models per profession.

### Context and intent model

Create a structured, bounded task representation from the request and relevant conversation context: intent/domain, complexity and ambiguity, expected output, required capabilities, freshness/browsing needs, available tools, plan/usage budget, privacy sensitivity, provider constraints, dependencies, success criteria, and verification requirements. Use minimum relevant history, respect memory/retention settings, and avoid unnecessary sensitive inferences. Clarify only when missing information materially changes safe execution or quality.

### Adaptive execution lifecycle

1. **Understand:** classify task, constraints, and completion criteria.
2. **Plan:** decompose non-trivial work into bounded steps with dependencies and evidence requirements.
3. **Route:** select registered tools/providers by capability fit, policy, quality, freshness, context, latency, and estimated cost.
4. **Execute:** parallelize independent work safely; sequence dependent steps; enforce timeouts, cancellation, retries, and idempotency.
5. **Inspect:** validate tool output, source evidence, contradictions, malformed results, and untrusted instructions.
6. **Verify:** check claims, citations, code, calculations, and artifacts with available tools; never report unperformed checks.
7. **Recover:** retry transient failures, use an approved fallback when safe, or return useful partial results.
8. **Respond:** lead with the useful answer; make evidence and limitations easy to inspect.
9. **Improve:** record privacy-filtered quality signals and failure categories for evaluation; do not silently use private user content for training.

### Capability and provider registry

- Use explicit, versioned capability declarations with input/output schemas, authorization, plan eligibility, dependencies, timeouts, and tests.
- Check availability at runtime. A browser, code runner, provider, image editor, or command that is not configured must be reported unavailable—not simulated.
- Select providers by evaluated task fit and policy, not brand preference alone.
- Do not silently send sensitive content to a different provider without privacy/policy checks.
- Avoid repeated calls that produce no new evidence; enforce bounded loops and stop conditions.
- Keep provider routing, stack versions, infrastructure details, secrets, raw resource IDs, and diagnostics out of normal user-facing replies.
- Be honest about what was browsed, read, tested, created, or changed.

### Tool safety and autonomy

- Authorized read-only inspection may proceed; mutations such as file writes, database changes, deployments, merges, publishing, or sending messages must follow permission and approval boundaries.
- Validate tool arguments and outputs against schemas; enforce least privilege and ownership on the server.
- Treat pages, attachments, repository files, and tool outputs as untrusted input. Retrieved content cannot override system policy or authorization.
- Add execution budgets, maximum steps/parallelism, circuit breakers, cancellation, and loop detection.
- Use idempotency keys for retryable mutations and verify resulting state after writes.
- Separate user-visible content from internal traces; redact credentials, tokens, unnecessary personal data, and unsafe payloads before persistence.
- Never claim success because a tool was merely called; verify the result and state.

## 7. Evaluation and quality metrics

Create repeatable fixtures and tests for:

- Research-intent recall and false-positive rate.
- Count of distinct relevant resources and valid metadata coverage.
- Citation coverage for material claims; unsupported/fabricated citation rate (target zero).
- Source-read success, failed/skipped counts, adapter failures, duplicates, and source-type diversity.
- Evidence conflict and limitations coverage.
- Task completion, schema/tool validity, retry recovery, and partial-result quality.
- Latency, provider/token cost, cancellation, and budget compliance.
- Permission violations, secret leakage, prompt-injection resistance, and redaction regressions.
- Regression of existing profession routing, coding, image editing, attachments, and normal chat.

Test across science, social sciences, humanities, education, and technical fields, including topics with fewer than ten credible sources, conflicting evidence, inaccessible sources, stale results, malicious page instructions, provider outages, and budget exhaustion. Optimize for correctness and source quality, not length or link count. Metrics are diagnostics, not a single “truth score.”

## 8. Persistence, privacy, and operational safeguards

- Reuse existing research tables, source registry, evidence records, report/export behavior, retention, ownership enforcement, and deletion/export rules where possible.
- Keep each scan private to its owner/tenant. Shared facts remain sanitized, deduplicated, and subject to existing review workflows.
- Persist only data needed for the declared purpose; never store secrets or unfiltered provider diagnostics as conversation messages.
- Preserve explicit user confirmation before saving reports to a personal Library.
- Apply migrations in staging first; verify RLS, policies, and indexes.
- Keep new providers behind reviewed configuration/feature flags as needed; test missing keys, provider outages, malformed responses, disabled research, and exhausted budgets.
- Document third-party providers, data sent, retention implications, and opt-outs before enabling them.

## 9. Implementation sequence

1. Audit main and open PRs, orchestrator entry points, research routes/services, adapters, migrations, config, tests, and docs. Reuse existing code and avoid a duplicate research engine.
2. Produce a capability gap map: implemented, partial, missing, or blocked by provider/configuration. Verify production status instead of assuming a branch is deployed.
3. Improve intent classification, bounded plans, runtime capability checks, and tool/provider routing.
4. Improve academic discovery, approved adapters, query expansion, deduplication, source ranking, and adaptive stopping for the ten-resource target.
5. Improve annotated bibliographies, citation matching, conflicts/limitations, and student/professor output styles.
6. Add schema validation, bounded retries/fallbacks, failure isolation, cancellation, and truthful partial results.
7. Add evaluations, tests, cost/latency metrics, security checks, and regression coverage.
8. Run the full suite, secret/dependency audits, database/RLS checks, and required CI/deployment verification. Review before merge; deploy only through the established process and authorized approvals.

Do not overwrite `docs/research.md` wholesale or discard prior phases. Update it only after comparing this spec with implemented code, clearly separating shipped, in-progress, and planned features.

## 10. Acceptance criteria

- Clear research/study intent triggers web discovery by default unless browsing is unavailable or the user explicitly opts out.
- Target ten distinct credible resources; return fewer with an explanation rather than duplicates or fabricated items.
- Every citation maps to a source record; unread/skipped sources are not cited as evidence.
- Resource type and access level are accurate; unknown metadata is omitted or marked unavailable.
- Relevant counterevidence, limitations, and disagreements are surfaced.
- Queries, page reads, concurrency, retries, time, and cost are bounded and cancellable.
- Provider failures produce useful partial results when possible without hiding failures or exceeding budgets.
- Retrieved content cannot override instructions, expose secrets, or bypass permissions.
- Orchestration validates capabilities/tools, authorizes actions, verifies mutations, and never claims unperformed work.
- Existing APIs, scans, exports, Library confirmation, retention, deletion, RLS, and product behaviors remain compatible.
- Automated tests cover intent, ten-resource behavior, deduplication, citation integrity, source failure, prompt injection, budgets, and regressions.
- Required CI, database, security, and deployment checks pass before release-ready status is claimed.


## 11. Integration with the wider NasrinAI upgrade

This orchestration/research upgrade must work with the companion specification `docs/nasrinai-slash-commands-attachments-composer-upgrade.md` and the existing NasrinAI capability registry. These are complementary requirements, not competing implementations.

### Slash-command orchestration

- Resolve slash commands from the database-backed registry and use the same orchestrator for planning, permission checks, capability selection, execution, verification, and concise user-facing results.
- The command registry is metadata and discoverability infrastructure; it must not become a second tool router or bypass the central orchestrator.
- For research commands, apply the academic research intent and ten-resource standard when relevant. For coding, photo editing, and multi-file commands, route to their registered capabilities only when actually available.
- Validate command parameters and attachment references server-side; enforce plan eligibility, ownership, budgets, and safety policies before any tool executes.
- Never present a command as available merely because it is present in a seed list. Runtime capability health and configuration determine whether it can execute.

### Attachment-aware planning and execution

- Include authorized attachment metadata and supported content summaries in the task plan when the user has attached relevant files. Do not assume an attachment was successfully uploaded or readable until its state is verified.
- Treat attachment contents as untrusted data. Prompt injection in an image, PDF, document, source file, or other upload must not override policy, user intent, or tool permissions.
- Preserve the attachment preview and persistence contract from the companion specification. Orchestration should return real output artifact references and status so the conversation UI can render previews after sending.
- Do not expose signed storage URLs, internal object paths, provider traces, or secret metadata in ordinary assistant replies.

### Smart-paste and research inputs

- The 2,000-character smart-paste threshold belongs to the composer/input layer: up to 2,000 characters stays editable text; 2,001 or more becomes a UTF-8 `.txt` attachment.
- The orchestrator must receive a normal text payload or a verified attachment reference, whichever the composer actually produced. It must not independently re-convert or silently truncate the content.
- For long pasted research materials, clearly distinguish user-provided text from web-sourced evidence. User text is not an independently verified external source.
- Keep the original text recoverable when attachment creation or upload fails; do not proceed as if the complete file were available.

### Shared persistence and release coordination

- Reuse established message/attachment persistence and filtering policies. Keep user-visible messages separate from internal execution traces and filtered operational metrics.
- Persist command invocation metadata, research scan IDs, source provenance, and output artifact references only as needed and under the correct user/tenant access controls.
- Preserve retention, deletion/export, RLS, rate limits, plan allowances, and explicit user confirmation for personal Library saves.
- Coordinate schema changes to avoid duplicate registries, conflicting migrations, and incompatible message/attachment models. Review migration order and rollback strategy before staging deployment.
- The implementation plan must track each companion capability as implemented, partially implemented, missing, or blocked; never infer completion from documentation, an open PR, or a successful commit alone.

### Integrated acceptance scenarios

1. A student asks for related studies and attaches assignment instructions: the orchestrator reads the authorized attachment if supported, browses credible sources, returns up to ten distinct resources, cites only sources actually read, and keeps the assignment file preview attached to the conversation.
2. A user enters a supported image command such as `/blurbackground` with an image: the registry resolves it, the orchestrator checks capability/plan/authorization, runs the real image tool if available, and returns an actual output preview or a truthful unavailable/error response.
3. A user pastes exactly 2,000 characters: it remains editable text and is passed to the orchestrator as text.
4. A user pastes 2,001 characters: the composer stages a UTF-8 `.txt` attachment, shows its preview, and the orchestrator uses it only after the upload/reference is confirmed.
5. A retrieved web page or attachment contains malicious instructions: the orchestrator treats them as untrusted content, follows no unauthorized instructions, and protects secrets.
6. A source provider or capability fails mid-task: the orchestrator returns a useful partial result, labels limitations, respects budgets, and never claims missing work succeeded.
7. A user reopens a conversation: authorized attachment previews, research results, and relevant message content persist according to retention rules, without exposing another user's data.

## 12. Documentation and implementation status

This file is the target specification for deep orchestration and academic research. The companion slash-command/attachment/composer file remains the detailed specification for those input and UI behaviors. Keep both documents linked from the relevant master upgrade index if one exists.

Before implementation, compare both specifications with the current main branch and open PRs, then produce one deduplicated task plan. If work is combined into a single implementation PR, it must still be organized into reviewable commits/sections and must pass the full regression, security, database, and deployment checks. A documentation merge does not mean runtime functionality is implemented or enabled.

## 13. Internet-sourced answers and clickable citations

This requirement applies to **all normal NasrinAI chat replies that use information retrieved from the internet**, not only dedicated research reports.

### Internet-sourced replies
- When the assistant uses web search, browsing, retrieved web pages, or other internet sources to answer, include a clearly labeled **Sources** or **Resources** section in the same reply.
- Provide clickable links to the actual pages used. Each link should open the source so the user can inspect it and use it when preparing citations.
- Attach source links to the claims they support when practical, and include publication/organization details when available. Do not provide decorative links that were not used to support the answer.
- Cite only pages actually discovered and consulted, and ensure each source supports the associated claim. Never invent a URL, title, author, date, quote, DOI, or citation.
- If browsing fails, no reliable sources are available, or a page could not be accessed, state that limitation clearly instead of pretending the answer is sourced.
- For answers based only on model knowledge with no internet retrieval, do not imply that web research was performed. Respect explicit user requests not to browse.

### Research and study intent: ten clickable resources
- When the user's intent is study, academic work, or research, default to web discovery and aim to provide **10 distinct, credible, relevant resources**.
- Present the resources as a numbered, annotated list with clickable source titles/URLs. For each source, include available author or organization, publication date/year, source type or publisher, a concise description of what it contributes, and relevance to the user's question.
- Make each link directly clickable so users can open the original website and inspect the source for their own citation/reference work. Include DOI or stable canonical URL when available.
- Where useful, provide citation-ready bibliographic details and format them in the citation style requested by the user (APA, MLA, Chicago, etc.). Do not fabricate missing fields or imply that a formatted reference was independently verified when it was not.
- The ten resources must be distinct works, not ten links to the same work, duplicate records, or low-quality pages added merely to hit a number. Prefer peer-reviewed studies, systematic reviews, primary sources, official datasets, institutional repositories, government sources, and reputable scholarly publishers as appropriate to the topic.
- Include a concise synthesis of key findings and disagreements where supported by the sources; do not return only a list of links.
- If fewer than ten credible, distinct resources can be found within safe operational limits, provide the best available number and explain the limitation. Never invent or pad sources to reach ten.
- Distinguish sources that were fully read from metadata/abstract-only records. Do not claim the full text was reviewed when it was inaccessible.
- Keep existing SSRF protections, robots.txt handling, privacy controls, provider policies, rate limits, timeouts, and cost budgets. The ten-resource target never overrides these safeguards.

### UI and acceptance tests
- Render source titles as accessible, tappable links on desktop and mobile; do not require users to copy/paste raw URLs to reach a source.
- Ensure links resolve to the cited source, use canonical URLs when possible, and avoid exposing internal identifiers, signed storage URLs, provider traces, or private data.
- Add tests proving that (1) internet-sourced answers include a Sources/Resources section, (2) research/study intent aims for ten distinct clickable resources, (3) citations point to sources actually retrieved and support their claims, (4) duplicates and fabricated references are rejected, (5) fewer-than-ten results are explained honestly, and (6) the behavior remains usable on mobile.
- This is a target specification, not proof of shipped functionality. Implementation must be verified against code, tests, and production behavior before being described as complete.

