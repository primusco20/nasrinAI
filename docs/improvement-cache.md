# Consented improvement cache: implementation contract

Status: the isolated private example table, redaction/eligibility helper, service-role-only review decisions, and content-free deletion lineage are implemented on review branches. No capture route, reviewer UI, export route, or chat ingestion path exists. This work does not collect chat content, and the preference-only consent version is explicitly rejected by the example table. The database functions are foundations, not a complete operational review console. Do not enable ingestion until a separately authenticated reviewer workflow, withdrawal integration, account-deletion integration, tests, and browser verification pass. Do not add a data-ingestion path before the deletion, expiry, redaction, review, and isolation checks below are complete.

## Goal

Allow people to voluntarily contribute carefully reviewed examples to improve
NasrinAI. A cache is not model training: stored examples can support evaluation,
curation, and later training preparation, but the model does not learn from a row
merely because it exists in a database.

## Non-negotiable defaults

- Guest conversations continue to expire after 24 hours. No guest content is copied
  into an improvement dataset by default.
- Signed-in Memory remains separate. Memory is a personal feature, not permission
  to use a person's content for product improvement.
- No training/improvement opt-in is inferred from account creation, Terms acceptance,
  use of the service, or Memory being enabled.
- No ingestion until the user has seen a clear, separate explanation and affirmatively
  opted in. Decline, missing choice, malformed consent, and unavailable consent state
  all mean do not collect.
- Consent is purpose-specific and versioned. Withdrawal stops future collection
  immediately; existing contributed examples must be findable and removable.
- Do not copy whole conversations wholesale. Select only an explicitly submitted
  example/turn, redact direct identifiers and secrets, and exclude high-risk/sensitive
  content. Human review is required before an example is approved for a training set.
- No provider receives the improvement cache automatically. Do not send cached examples
  to an external model unless that processing is separately reviewed and disclosed.
- No use for advertising, profiling, or decisions about people.

## Data lifecycle to implement

1. **Explain and ask.** A separate optional choice describes exactly what is shared,
   the purpose (evaluation and potential improvement of NasrinAI), retention, review,
   and how to withdraw. It must not be pre-checked, bundled with Memory, or required
   to use chat. Guests need the same clear choice before any guest content is copied.
2. **Record consent.** Record subject scope (guest-session or account), consent version,
   affirmative choice, timestamp, and withdrawal timestamp. Keep the minimum evidence
   needed to enforce the choice; never trust a client-supplied user ID.
3. **Capture narrowly.** Only collect after consent is active. Store a single
   eligible example, not the full transcript. Fail closed if the consent lookup,
   redaction, eligibility, or storage check fails.
4. **Minimize and protect.** Reject secrets, credentials, payment data, direct
   identifiers, sensitive personal data, and content unsuitable for a general-purpose
   dataset. Encrypt at rest using platform-managed database/storage controls; use
   service-role-only access, least privilege, and audit access.
5. **Expire and delete.** Use an explicit bounded retention period with server-side
   expiry and a scheduled purge. Migration 020 adds a service-role-only subject deletion
   function for consent withdrawal, account deletion, and privacy requests, plus
   content-free deletion lineage containing request IDs, opaque example IDs, reason codes,
   counts, and timestamps. The caller must derive the subject from a verified server-side
   identity; never accept an arbitrary subject ID from the browser. Connect the function
   to consent withdrawal and account deletion before collection is enabled.
6. **Human review and release.** Migration 020 adds a service-role-only review function
   that permits one decision on a pending, unexpired example only while the exact consent
   is still active. Decisions use a fixed reason-code allowlist; reviewer ID and decision
   are recorded without free-text notes. A reviewer UI, staff authentication/authorization,
   dual-control policy, and curated export are not implemented yet. Only approved, redacted
   examples may enter a later curated export. Do not claim an already-trained model can be
   untrained; do not train on an example until withdrawal/deletion guarantees and model-
   release policy are documented.
7. **Observe safely.** Log counts and outcomes only, never raw prompts or example text.
   Add metrics for consented captures, rejected examples, purge failures, and withdrawal
   completion without recording the content itself.

## Required tests before enabling collection

- Default/no choice and explicit decline produce zero examples.
- Guest and signed-in consent cannot be forged by changing an owner ID in a request.
- One user's consent cannot authorize another user's data.
- Memory on does not enable improvement collection; Memory off does not break consent.
- Withdrawal blocks the next capture and removes all linked eligible rows.
- Guest session expiry purges linked examples on the same bounded schedule.
- Redaction/rejection failure, database error, or consent lookup error fails closed.
- Retention boundary tests cover just-before, exactly-at, and just-after expiry.
- RLS and grants deny anon/authenticated direct table access; service access is explicit.
- Export, account deletion, privacy notice, and UI wording match actual behavior.

## Release sequence

1. Review this policy and have the Privacy Notice reflect the exact final behavior.
2. Implement versioned consent UI and server-enforced consent records only (current branch; verify tests and deployment before release).
3. Add the isolated, private improvement-example store and purge job (current follow-up branch; no capture endpoint).
4. Add redaction/eligibility gates and tests before connecting any capture path (current branch; isolated helper only, with CI review required).
5. Add a staff-only reviewer UI/API with explicit authorization, audit access, and no
   free-text sensitive notes; connect it only to the guarded database function.
6. Wire consent withdrawal, account deletion, and privacy requests to the subject-deletion
   function using server-verified identity; verify tombstones and purge behavior in staging.
7. Implement and test a curated export that excludes deleted/rejected/expired examples.
8. Keep capture disabled in production until every test passes and the live migrations,
   scheduled purge, withdrawal, account deletion, and review flow are verified.

## Explicitly out of scope

- Turning every guest conversation into training data.
- Treating a transient response cache as training data.
- Using personal Memory as an improvement dataset.
- Automatic external-provider uploads or automatic model fine-tuning.
- Changing billing, subscriptions, model routing, or ordinary chat retention.
