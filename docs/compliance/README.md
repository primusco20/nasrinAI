# Privacy, terms and compliance — audit and plan

Prepared 5 October 2026 from the code in this repository. This is compliance
engineering, not legal advice. **The following controls were identified and
implemented based on the requirements reviewed. Final legal compliance should
be validated by qualified Philippine counsel and a privacy professional.**

Markers: **REQUIRES INPUT**, **REQUIRES BUSINESS DECISION**,
**REQUIRES VERIFICATION**, **REQUIRES LEGAL REVIEW**.

## A. Summary

NasrinAI is a chat assistant (guests and signed-in users) with file and link
reading, web search, read-aloud, picture making and prepaid Max/Ultra plans
(PayMongo). It runs on Vercel with a Supabase database, and sends messages to
OpenAI and, when enabled, Google Gemini. It does not act in other systems for
users. Biggest gaps before launch: business identity and contacts, a refund
policy, Gemini free-tier data use, provider DPAs, retention decisions, and
an age policy. Server-side Terms acceptance, data export, delete-all-chats
and account deletion are now implemented.

## B. What the application actually does (relevant findings)

| Area | Finding | Where |
| --- | --- | --- |
| Sign-in | Supabase Auth: email one-time code; Google OAuth (PKCE) when enabled. No passwords, no MFA beyond email possession | `src/auth/` |
| Sessions | Refresh token in HttpOnly/Secure/SameSite=None cookie `nasrin_rt` (path `/v1/auth`); short-lived Google PKCE verifier in HttpOnly/Secure/SameSite=None cookie (10 min, path `/v1/auth/google`); access token in memory; guest token (signed, 24 h) in localStorage | `src/auth/routes.js`, `public/app.js` |
| Chat storage | `conversations`/`messages` in Supabase. Guests: `expires_at` 24 h, purged by the scheduled retention job. Users: retention is controlled by `nasrin_prefs.retention` and enforced hourly | `src/conversations.js`, migration 001 |
| Files | Parsed in memory, sent to the model, **not stored**; names saved in the message | `src/attachments.js` |
| Links | Fetched by the server (SSRF-protected), text used for one turn, **not stored** | `src/web/read-link.js` |
| Web search | OpenAI Responses API `web_search` tool | `src/web/search.js` |
| AI providers | OpenAI (chat, TTS, search); Gemini (optional chat level 1, images); optional owner-run model | `src/ai/` |
| Redaction | Emails, phone and card numbers removed before text leaves the server (on by default); such messages never go to a provider that trains on data | `src/ai/redact.js`, `src/ai/policy.js` |
| Automated processing | Message classification for model choice; PII detection for routing; rate/budget limits. No decisions with legal effects | `src/ai/classify.js`, `src/limits.js` |
| Pictures | Stored as bytes in `generated_images`, owner-only, deleted with the conversation | migration 004, `src/images.js` |
| Payments | PayMongo hosted checkout; webhook verified; we store plan, amount, PayMongo reference. **No card data** | `src/payments/` |
| Plans | Prepaid 30-day periods, **no auto-renewal** | migration 002, `src/plans.js` |
| Logs | JSON logs (no message text; secrets redacted) to Vercel | `src/log.js` |
| Usage records | Model, tokens, cost, task, level — no text | `usage_events` |
| IP addresses | Used in rate-limit bucket names in `rate_counters`, purged after ~2 days | `src/limits.js`, migration 001 |
| Cookies / storage | 2 functional cookies; localStorage for session/preferences; Vercel Speed Insights script | `public/` |
| Terms acceptance | **New:** recorded server-side per version (insert-only table); signed-in use blocked until accepted | migration 005, `src/legal.js` |
| Data rights | **New:** export JSON, delete all chats, delete account (also deletes the Supabase Auth user) | `src/legal.js`, Settings |
| Marketing | None sent; no marketing consent needed today | — |
| Agentic actions | None (no tools that change external systems) | — |

## C. Data inventory

| Data | Source | Purpose | Basis (DPA s.12) | Storage | Recipients | Retention | Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Email, account ID | User / Google | Sign-in | Contract | Supabase Auth | Supabase, email sender | Until account deletion | Delete account |
| Google name/photo | Google | (not used by us) | Contract | Supabase Auth metadata | Supabase | Until account deletion | Delete account |
| Guest ID | Generated | Session, limits | Contract; legitimate interest | Browser + DB owner_id | — | 24 h | Automatic |
| Messages & replies | User / AI | Answering | Contract | Supabase | OpenAI / Gemini / own model | Guests 24 h; users: standard = until deleted, or the user's selected keep-time (1–3650 days) | Delete chat / all / account |
| Files | User | Answer one message | Contract | Not stored | AI provider | Not stored | — |
| Link page text | Website | Answer one message | Contract | Not stored | AI provider | Not stored | — |
| Pictures | AI | Requested output | Contract | Supabase | Gemini / OpenAI images | Guests 24 h; users **30 days** (`IMAGE_RETENTION_DAYS`) | With conversation; automatic |
| Memory notes | User (confirmed) | Personalised answers | Contract (user request) | `user_memories` | AI provider (as context) | Until deleted | Settings; account deletion |
| Business documents | Business | Answers for its users | Contract with business | `knowledge_docs/chunks` | AI provider (matching parts) | Until business deletes | Business API |
| Connector events | Business system | Answers about orders etc. | Contract with business | `connector_events` | AI provider (as context) | 30 days | Automatic |
| Business API keys, Page tokens | Business | Calling its systems / Messenger | Contract with business | `connectors`, `channels` (AES-GCM) | — | Until business removes | Business API |
| Messenger sender ID (PSID) | Meta | Guest chat on a Page | Contract | `conversations.owner_id` | Meta | 24 h (guest chat) | Automatic |
| Pending actions | Model + user | Confirm before changes | Contract | Signed token (client) + counter | — | 10 minutes | Automatic |
| Read-aloud text | AI reply | Audio | Contract | Memory cache only | OpenAI | Minutes (cache) | Automatic |
| Payment record | PayMongo | Plan access, accounting | Contract; legal obligation | `plan_periods` | PayMongo | **REQUIRES ACCOUNTANT REVIEW** | Kept on account deletion |
| Terms acceptance | User | Proof of agreement | Legal obligation; legitimate interest | `legal_acceptances` | — | **REQUIRES LEGAL REVIEW** | Kept on account deletion |
| IP address | Request | Abuse prevention | Legitimate interest | `rate_counters` keys | Vercel | ~2 days | Automatic |
| Usage metadata | Server | Cost control | Legitimate interest | `usage_events` | — | **24 months** | User ID replaced with `deleted-user` on account deletion |
| Server logs | Server | Errors, security | Legitimate interest | Vercel | Vercel | **REQUIRES VERIFICATION** | Vercel retention |
| Hashed email in limit keys | Sign-in | Code flood protection | Legitimate interest | `rate_counters` | — | ~2 days | Automatic |

## D. Data flow

```
Browser ──HTTPS──▶ Vercel function (NasrinAI server)
   │                 ├──▶ Supabase (Auth: email codes / Google; DB: chats, pictures, plans, usage)
   │                 ├──▶ OpenAI (answers, read-aloud audio, web search)   [redacted text]
   │                 ├──▶ Google Gemini (level-1 answers, pictures)        [optional; free tier only for public text]
   │                 ├──▶ Websites people link to (page text, one turn)
   │                 └──▶ PayMongo (checkout; webhook back)
   ├──▶ PayMongo hosted checkout (payment details go only there)
   └──▶ Browser speech service (voice typing, device read-aloud)
```

## E. Compliance matrix

| Requirement | Law / rule | Applies? | Status | Code / document | Action |
| --- | --- | --- | --- | --- | --- |
| Privacy notice (transparency) | RA 10173 s.16, IRR | Yes | PARTIALLY COMPLIANT | `public/legal/privacy.md` | Fill placeholders; legal review |
| Lawful basis per purpose | RA 10173 s.12–13 | Yes | REQUIRES LEGAL REVIEW | Privacy Notice s.2 | Confirm bases; sensitive info volunteered in chats |
| Data subject rights (access, portability, erasure) | RA 10173 s.16–18 | Yes | PARTIALLY COMPLIANT | Export / delete in Settings | Add request intake by email, response times |
| Security measures | RA 10173 s.20, IRR | Yes | PARTIALLY COMPLIANT | `docs/security.md` | Pen test; backup review |
| Breach management & notification | RA 10173 and applicable NPC rules | Yes | PROCEDURE IMPLEMENTED | `docs/incident-response.md` | Keep contacts/roles current; verify notification deadlines with counsel/NPC |
| DPO designation | RA 10173, IRR | Likely | REQUIRES BUSINESS DECISION | — | Designate DPO; publish contact |
| NPC registration | NPC Circular 2022-04 (250+ employees, sensitive data of 1,000+ people, high-risk, or automated decision-making/profiling) | REQUIRES LEGAL REVIEW | REQUIRES VERIFICATION | — | Assess against thresholds |
| Cross-border transfer safeguards | RA 10173 s.21 (accountability) | Yes | REQUIRES VERIFICATION | Privacy Notice s.5 | DPAs with OpenAI, Google, Supabase, Vercel, PayMongo |
| Processor agreements | RA 10173 s.14, IRR | Yes | REQUIRES VERIFICATION | checklist below | Sign/confirm DPAs |
| Online selling disclosures | RA 11967 Internet Transactions Act | Likely (paid plans to PH consumers) | REQUIRES LEGAL REVIEW | Terms s.6 | Business details, complaint handling, refund rules are documented; verify legal sufficiency |
| Consumer protection | RA 7394 Consumer Act; DTI rules | Yes | REFUND POLICY DOCUMENTED | Terms s.6 | Successful prepaid payments are generally non-refundable; unused limits/time do not create a refund; platform closure is refundable for affected prepaid periods, subject to applicable law |
| Electronic contracts | RA 8792 E-Commerce Act | Yes | COMPLIANT (mechanism) | Server-side acceptance log | Legal review of wording |
| Tax / receipts | NIRC, BIR rules | Yes (if selling) | REQUIRES ACCOUNTANT REVIEW | — | BIR registration, invoicing |
| Unlawful content, hacking | RA 10175 Cybercrime Act | Context | COMPLIANT (policy) | Terms s.4 | Enforcement process |
| GDPR / UK GDPR | EU/UK | Only if offering to EU/UK users | REQUIRES BUSINESS DECISION | — | Decide target markets |
| US state privacy laws | e.g. California | Unlikely at current scale | NOT APPLICABLE (for now) | — | Revisit with growth |

## F. Missing controls (prioritised)

**CRITICAL**
1. Business identity and contacts: NasrinAI, 142 Pag-asa Village, Matina Apalaya, Davao City, support@nasrinai.com, +63 947 387 5093 (owner, 2026-10-05). Data Protection Officer still **REQUIRES INPUT**.
2. Gemini free tier may use content to improve Google's products — move the Gemini key's project to paid billing or keep `GEMINI_API_KEY` unset — **REQUIRES BUSINESS DECISION**.
3. Refund policy — **DECIDED AND DOCUMENTED**: successful Max/Ultra payments are generally non-refundable; unused plan time/limits do not create a refund; platform closure triggers an appropriate refund for the affected prepaid period, subject to applicable law.
4. Breach response procedure and owner not defined.

**HIGH**
5. Retention for signed-in chats/files/pictures — **IMPLEMENTED** through migration 015 and hourly cron. Payment and legal-acceptance retention remain subject to accountant/legal requirements.
6. DPAs with OpenAI, Google, Supabase, Vercel, PayMongo, email sender — **REQUIRES VERIFICATION**.
7. Age requirement and handling of minors — **REQUIRES BUSINESS DECISION**.
8. NPC registration and DPO assessment.
9. Supabase project region and backup retention — **REQUIRES VERIFICATION** (provider-controlled; application cannot enforce backup deletion).

**MEDIUM**
10. Privacy request intake (email form) and identity verification steps documented.
11. Receipts/invoices for plan purchases.
12. Vercel log and Speed Insights data review.

**LOW**
13. Per-conversation export; in-app notice history of Terms versions.

## G. Documents that are needed

- **Terms of Service** (includes Acceptable Use, AI use, Plans & payments, refunds placeholder): `public/legal/terms.md`
- **Privacy Notice** (includes cookies and browser storage): `public/legal/privacy.md`

Not created, because they would add no value yet: separate Cookie Policy (two
functional cookies, covered in the notice), separate Subscription terms
(covered in Terms s.6), DPIA (recommended if usage grows or automated
decisions are added — REQUIRES LEGAL REVIEW), ROPA (template below).

## I. Technical implementation (done in this change)

- Migration 005: `legal_acceptances` (insert-only for the server), `delete_user_data()`.
- Migration 018: `improvement_consent_events` records only a versioned grant/decline/withdrawal event (no message text); service-role-only access and hourly bounded-retention purge. `/v1/improvement-consent` records the choice but does not enable collection.
- `src/legal.js`: Terms gate for signed-in chat, pictures and checkout (server-side), acceptance, export, delete all chats, delete account (+ Supabase Auth user via admin API).
- Routes: `GET /v1/legal`, `POST /v1/legal/accept`, `GET /v1/account/export`, `POST /v1/account/delete`, `DELETE /v1/conversations`.
- Page: Terms prompt after sign-in and when the version changes (no re-acceptance at every login); Settings → Your data; legal links under the composer; `/legal.html?doc=terms|privacy`.
- Settings: `LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION`, `LEGAL_REQUIRE_TERMS`.

## J. Tests

`test/legal.test.js`: Terms required and recorded server-side with version;
wrong version refused; guests unaffected; new version requires re-acceptance
and keeps history; export; delete-all limited to the caller; account deletion
removes chats, signs out, deletes the auth user and removes the ID from usage
records. `db/tests/005_legal.test.sql`: acceptance records cannot be edited or
deleted; deletion keeps proof of acceptance.

## K. Before launch

- [ ] Fill every [PLACEHOLDER] in both documents; set the effective date.
- [ ] Run migrations 002–005 in Supabase.
- [x] Retention is implemented with a database purge job. Refund policy is documented in Terms s.6; update `LEGAL_TERMS_VERSION` whenever the legal text changes.
- [ ] Gemini on paid tier (or off); confirm OpenAI data controls.
- [ ] Sign/confirm processor agreements (checklist below).
- [ ] Confirm/formally document the DPO designation and assess NPC registration.
- [x] Write the breach response procedure (detect, contain, assess, notify NPC/users as required, review). See `docs/incident-response.md`.
- [ ] BIR registration and receipts for paid plans.
- [ ] Legal review of both documents.

### Processor checklist (each provider)
Processing instructions · confidentiality · security measures · subprocessors ·
breach assistance · help with data subject requests · deletion/return ·
audits · international transfers and regions · retention.

### ROPA template
Processing activity · purpose · data categories · data subjects · recipients ·
systems · transfers · retention · security · legal basis · owner.

### Sources
- Data Privacy Act of 2012 and IRR: https://privacy.gov.ph/data-privacy-act/
- NPC Circular 2022-04 (registration): https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04-1.pdf
- NPC reminder on DPO and registration: https://privacy.gov.ph/reminder-on-mandatory-data-protection-officer-and-data-processing-system-registration/
