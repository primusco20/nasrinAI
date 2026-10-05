# NasrinAI roadmap

The phases from the master engineering prompt, with where each stands. Phase
numbers do not change; new requirements are added to the phase they belong in.
Each step ships as a small pull request and waits for approval.

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Discovery (audit of the original Nasrin chat) | Done |
| 1 | Security foundation | Done |
| 2 | AI provider layer, chat page | Done (live) |
| 3 | Local AI runtime | Done: `AI_PROVIDER=local` ([ADR-004](decisions/004-local-model-runtime.md)) |
| 4 | AI router, then image creation | **In progress**: 4.1 router + cost-aware routing done ([routing.md](routing.md)); 4.2 pictures done in code (questions, brief, regenerate, guest ceiling); live-key test pending |
| 5 | Tool engine | **In progress**: steps 1–2 (registry, checks, permissions, read-only tools, chat runs tools) done ([tools.md](tools.md)) |
| 6 | Connector engine | Planned |
| 7 | RAG + memory | Planned |
| 8 | GPT teacher / dataset pipeline | Planned |
| 9 | Evaluation + red team | Planned |
| 10 | Production hardening | Planned |

## Phase 0 — Discovery

Audit of the original Crazybite Nasrin chat: findings H1–H2 and M1–M6 in
[security.md](security.md). The original code is kept unchanged in
`reference/crazybite-chat/`.

## Phase 1 — Security foundation

Gateway (signed-in users, guest sessions, business keys), tenant from the
credential only, shared rate limits and daily budgets, usage records without
text, RLS on every table, security headers, tests and CI.

## Phase 2 — AI provider layer

Provider interface with OpenAI and a test provider; the chat page; NasrinAI /
Pro / Max / Ultra tiers; photos and files in chat; Settings with appearance
and natural voices; app icon; sign-in page (email code, Google; [sign-in.md](sign-in.md)). Plans for Max and Ultra with PayMongo checkout ([plans.md](plans.md)).

## Phase 3 — Local AI runtime

NasrinAI's own model through any OpenAI-compatible server (Ollama, llama.cpp,
LM Studio, vLLM), behind the provider interface, never exposed to clients.
Guide: [local-model.md](local-model.md).

## Phase 4 — AI router, then image creation

**4.1 AI router** (done). Cost-aware smart routing added 2026-10-05: logic tier, levels 1–5, budgets, bounded escalation, telemetry ([routing.md](routing.md)); web links and search ([web.md](web.md)). LOCAL, GPT and AUTO with policy-controlled routing: each
tier names its provider; AUTO uses NasrinAI's own model when it is up and
falls back to GPT when allowed; redaction is applied per provider actually
used; usage records the provider that answered.

The router also routes by **task**, not only by tier, so later features can
send cheap steps (questions, briefs) to a cheap model and only the expensive
step to an expensive one. This is the one piece of 4.2 prepared in 4.1.

**4.2 AI image creation** (added 2026-10-05). Photo + idea → adaptive
follow-up questions → creative brief → one generated image → download or
regenerate. A capability of NasrinAI, not a separate app, with its own
image-provider interface (Gemini first, replaceable). Full requirement and
design: [features/image-creation.md](features/image-creation.md).

It belongs in Phase 4 because it needs the router (cheap text model for the
questions and brief, a separate image provider for generation) and nothing
from Phases 5–7.

Steps, each its own pull request:

1. Storage and limits: private storage bucket, image jobs table, generation
   limits and concurrency guard (database migration 002).
2. Image provider interface and the Gemini provider (server-side key).
3. The flow on the server: analyze, adaptive questions, brief, generate.
4. The page: Create image mode with the UPLOAD → COMPLETE states.
5. Download, regenerate, retention clean-up, docs.

## Phase 5 — Tool engine

Tool registry, schema validation, permission and tenant checks, risk
classification, confirmation, execution, auditing.

## Phase 6 — Connector engine

REST, GraphQL, webhooks, OAuth, database adapters, POS/CRM integrations, with
strong security controls.

## Phase 7 — RAG + memory

Document ingestion, embeddings, tenant-scoped retrieval, permission filtering,
memory, deletion, retention, security filtering.

## Phase 8 — GPT teacher / dataset pipeline

Synthetic data, evaluation, filtering, PII and secret detection, human
approval, dataset versioning, local model improvement. No customer data is
used for training without explicit permission.

## Phase 9 — Evaluation + red team

AI benchmarks, security, jailbreak, prompt-injection, tool-abuse and
data-leakage tests, regression tests. Includes image creation: instructions
hidden in uploaded photos, brief injection, limit bypass.

## Compliance (added 2026-10-05, runs alongside Phases 4–10)

Privacy Notice, Terms, server-side Terms acceptance, data export and deletion
are in place; business decisions and legal review are listed in
[compliance/README.md](compliance/README.md). Legal review must finish before
Phase 10's production readiness review.

## Phase 10 — Production hardening

Observability, backups, disaster recovery, deployment and dependency security,
performance, cost optimization (including image generation spend), security
review, production readiness review.
