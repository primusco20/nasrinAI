# Pull request change log

This file records the intent and outcome of repository pull requests and is updated alongside code changes. Entries describe the work at PR level; the linked PR is the source of truth for the full diff and review history.

## Required documentation workflow

For every future NasrinAI PR:

1. Update the relevant feature, architecture, operations, security, or database Markdown document in the same PR.
2. Add or update an entry in this change log with the PR link, intent, key files/areas, validation status, and any known follow-up.
3. For UI work, record the intended interaction/layout and the regression test that protects it.
4. For API/backend work, document behavior, authorization, errors, limits, and compatibility.
5. For migrations, document the migration and audit RLS enabled/forced state as appropriate, policies, grants/revokes, tenant/owner isolation, and database tests.
6. State what was actually tested. Do not call a check passing unless its result was observed. Do not merge while required checks are failing or pending.

## Recent PR backfill

Status reflects the most recent repository listing at the time this file was added.

| PR | Change | Status | Documentation note |
| --- | --- | --- | --- |
| [#190](https://github.com/primusco20/nasrinAI/pull/190) | Separate Usage and Billing settings pages; inline Usage spinner and independent loading | Open | Adds dedicated Usage/Billing navigation and regression coverage. Test regex escaping was faulty and is being replaced with direct string assertions. Vercel was observed passing; full test result must be rechecked after the correction. |
| [#189](https://github.com/primusco20/nasrinAI/pull/189) | Secure coding and file workspace architecture | Open | Design-only; execution remains blocked until an isolated disposable Linux runner is available and verified. See [secure workspace design](architecture/secure-workspace.md). |
| [#188](https://github.com/primusco20/nasrinAI/pull/188) | Usage refresh indicator and Billing section | Merged | Initial UI attempt did not fully separate the destinations; follow-up is PR #190. |
| [#187](https://github.com/primusco20/nasrinAI/pull/187) | Revert PR #186 Settings UI changes | Merged | Restored the prior Settings UI files; see the PR diff for exact scope. |
| [#186](https://github.com/primusco20/nasrinAI/pull/186) | Restyle Settings and hide token caps | Merged | Followed by the rollback in PR #187 after the resulting UI was not wanted. |
| [#185](https://github.com/primusco20/nasrinAI/pull/185) | Marketing-aware cache for briefs and creative assets | Merged | Cache safety, ownership, expiration, size limits, and provider behavior must be verified against the implementation before production readiness is claimed. |
| [#184](https://github.com/primusco20/nasrinAI/pull/184) | Usage meters without consumption disclaimers | Merged | Usage presentation change. |
| [#183](https://github.com/primusco20/nasrinAI/pull/183) | Usage and image consumption status bars | Closed, not merged | Not part of the merged implementation unless included by a later PR. |
| [#182](https://github.com/primusco20/nasrinAI/pull/182) | Desktop workspace navigation | Merged | Responsive navigation change. |
| [#181](https://github.com/primusco20/nasrinAI/pull/181) | Home Screen Settings section spacing | Merged | Settings layout refinement. |
| [#180](https://github.com/primusco20/nasrinAI/pull/180) | Desktop workspace navigation | Closed, not merged | Superseded/duplicated by later work; consult PR history for exact disposition. |
| [#179](https://github.com/primusco20/nasrinAI/pull/179) | Tablet workspace sizing | Merged | Responsive layout change. |
| [#178](https://github.com/primusco20/nasrinAI/pull/178) | Settings spacing in iOS Home Screen mode | Merged | Mobile layout refinement. |
| [#177](https://github.com/primusco20/nasrinAI/pull/177) | Desktop workspace navigation | Closed, not merged | Superseded/duplicated by later work; consult PR history for exact disposition. |
| [#176](https://github.com/primusco20/nasrinAI/pull/176) | Tablet workspace sizing | Closed, not merged | Superseded/duplicated by later work; consult PR history for exact disposition. |
| [#175](https://github.com/primusco20/nasrinAI/pull/175) | Mobile safe areas and landscape adaptation | Merged | Responsive layout change. |
| [#174](https://github.com/primusco20/nasrinAI/pull/174) | Adaptive desktop, tablet, and mobile layouts | Closed, not merged | Consult PR history for exact disposition. |
| [#173](https://github.com/primusco20/nasrinAI/pull/173) | Weekly token allowances and live usage UI | Merged | Usage and plan-limit behavior; API/security details belong in the relevant feature docs. |
| [#172](https://github.com/primusco20/nasrinAI/pull/172) | Saved-chat Memory recall and routing | Merged | Memory retrieval behavior; preserve permission and ownership checks. |
| [#171](https://github.com/primusco20/nasrinAI/pull/171) | Remove Appearance subtitle and tighten spacing | Merged | Settings presentation change. |
| [#170](https://github.com/primusco20/nasrinAI/pull/170) | Cross-chat memory recall and four-day summaries | Merged | Memory retrieval behavior; preserve user permissions and scope. |
| [#169](https://github.com/primusco20/nasrinAI/pull/169) | Generic cross-chat memory recall | Merged | Memory retrieval behavior; preserve user permissions and scope. |
| [#168](https://github.com/primusco20/nasrinAI/pull/168) | Permission-aware memory acknowledgements | Merged | Memory behavior and permission handling. |
| [#167](https://github.com/primusco20/nasrinAI/pull/167) | Recall saved chats and generated images | Merged | Recall behavior; verify ownership and Memory preferences. |
| [#166](https://github.com/primusco20/nasrinAI/pull/166) | Restore Billing settings, spacing, and account switching | Merged | Settings/account behavior; see PR for exact implementation scope. |
| [#165](https://github.com/primusco20/nasrinAI/pull/165) | Respect Memory setting in saved-chat recall | Merged | Memory preference must gate retrieval. |
| [#164](https://github.com/primusco20/nasrinAI/pull/164) | Saved conversation recall and proactive Library inventory | Merged | Recall and Library behavior; preserve ownership and permissions. |
| [#163](https://github.com/primusco20/nasrinAI/pull/163) | Memory settings authentication and Library context | Merged | Authentication and Library context behavior. |
| [#162](https://github.com/primusco20/nasrinAI/pull/162) | Cache, SSRF, definer, and video ownership hardening | Merged | Security-sensitive change; keep security/database documentation aligned with implementation. |
| [#161](https://github.com/primusco20/nasrinAI/pull/161) | Harden SECURITY DEFINER search paths | Merged | Database security hardening; review function privileges and search paths for future migrations. |

## PR #190 — Usage and Billing separation

### Intended behavior

- Settings presents **Usage** and **Billing** as separate navigation destinations.
- Usage contains usage meters and its inline loading indicator.
- Billing contains the current plan, upgrade/renew action, payment history, and billing disclosures.
- Opening Usage loads usage data; opening Billing loads billing data.
- Periodic usage refresh runs only while the Usage page is visible.

### Scope

The UI change is limited to `public/index.html`, `public/app.js`, and `public/app.css`, with a focused regression test at `test/settings-usage-billing-separation.test.js`. No backend endpoint, billing rule, schema, or RLS policy is intended to change.

### Validation

The original test used over-escaped regular expressions. The test is being simplified to explicit string and page-boundary assertions to avoid fragile regex escaping. Verify the repository's test command and all required CI checks after the correction; do not treat the fix as verified until those checks return results.
