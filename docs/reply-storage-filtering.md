# Assistant reply persistence and filtering

## Requirement

Every final assistant reply produced by the chat flow must be persisted in the existing `messages` table, scoped to the current conversation and tenant. Use the existing `conversations.add` path; do not create a second reply store or duplicate the same message in another table.

## Persistence boundary

Before a reply is saved or returned:

1. Finish the user-facing formatting transformations.
2. Apply `keepIdentity` and `cleanReply` to the final text. This removes control characters, normalizes line endings, trims whitespace, and enforces the applicable response length cap.
3. If the result is empty or invalid, persist and return a short safe fallback rather than storing an empty or raw provider response.
4. Save only the final user-facing answer. Never store raw provider payloads, hidden prompts, internal reasoning, orchestration context, tool credentials, environment variables, or raw error/stack traces as assistant message content.
5. Keep web citations that are part of the final answer; source metadata remains in the existing web-answer path where applicable.

The shared `finish()` function is the central enforcement point so deterministic replies, policy refusals, tool-assisted answers, and model-generated replies use the same persistence filter.

## Scope and privacy

- Keep conversation ownership and tenant checks unchanged. A conversation/message must never be readable by another tenant or actor.
- Saving chat history is distinct from opt-in Memory. Persisting a reply must not enable Memory or add a note to the user's memory.
- Guest conversations must keep their configured expiry (currently 24 hours); expiry cleanup deletes the conversation and its messages.
- Existing signed-in history follows the product's existing retention/deletion controls. Do not introduce indefinite retention as part of this change.
- Usage telemetry remains metadata-only and must not include message text.
- Do not silently use stored conversations as training data. Any improvement/analytics use requires its own documented purpose, filtering, access controls, retention, and applicable consent.

## Filtering limits

`cleanReply` is output sanitization, not a guarantee that every secret, personal detail, unsafe instruction, or inaccurate claim is detected. Do not describe it as a comprehensive content moderation or PII-redaction system. If stronger secret/PII filtering is added, implement a dedicated, tested filter with safe false-positive behavior; never silently corrupt legitimate code or ordinary answers.

## Verification

Tests should cover the shared finish path and prove that:
- assistant messages are saved after sanitization, not before it;
- control characters and overlong output are normalized/capped;
- an empty/invalid output uses the safe fallback;
- the stored content equals the user-facing final content;
- tenant isolation, guest expiry, edit/regenerate deletion, and user-controlled retention remain intact;
- raw provider errors, tool payloads, hidden prompts, and credentials are never saved as assistant content.

A code change is not proof of production behavior. Run tests and verify the deployed database path before claiming the behavior is live.
