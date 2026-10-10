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
| [#190](https://github.com/primusco20/nasrinAI/pull/190) | Separate Usage and Billing settings pages; inline Usage spinner and independent loading | Open | Adds dedicated Usage/Billing navigation, direct string/page-boundary regression assertions, and documentation workflow. Latest observed CI: test job passed (including npm test and secret scan); database job's test step passed and the job was still finishing cleanup when checked. Vercel passed on the latest commit checked. Keep PR open until all required checks complete successfully. |
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


## Earlier PR index (#91–#160)

The following older PRs are backfilled by title and outcome. Each link opens the full diff, review, and any original test evidence. The short labels below are summaries of the PR titles, not a substitute for reviewing the implementation.

| PR | Change | Status |
| --- | --- | --- |
| [#160](https://github.com/primusco20/nasrinAI/pull/160) | Creative intent routing and generation consent | Merged |
| [#159](https://github.com/primusco20/nasrinAI/pull/159) | Video conversation ownership validation | Merged |
| [#158](https://github.com/primusco20/nasrinAI/pull/158) | Special-use IPv4 filtering and semantic cache security | Merged |
| [#157](https://github.com/primusco20/nasrinAI/pull/157) | SSRF destination filtering | Merged |
| [#156](https://github.com/primusco20/nasrinAI/pull/156) | Semantic cache function search paths | Merged |
| [#155](https://github.com/primusco20/nasrinAI/pull/155) | Server-only RLS boundary | Merged |
| [#154](https://github.com/primusco20/nasrinAI/pull/154) | AI disclaimer under each reply | Merged |
| [#153](https://github.com/primusco20/nasrinAI/pull/153) | Per-reply accuracy reminder and FAQ label | Merged |
| [#152](https://github.com/primusco20/nasrinAI/pull/152) | Chat AI accuracy reminder | Merged |
| [#151](https://github.com/primusco20/nasrinAI/pull/151) | Privacy settings after expired sign-in; role answers | Merged |
| [#150](https://github.com/primusco20/nasrinAI/pull/150) | Improvement-example deletion and consent withdrawal | Merged |
| [#149](https://github.com/primusco20/nasrinAI/pull/149) | Improvement review and deletion safeguards | Merged |
| [#148](https://github.com/primusco20/nasrinAI/pull/148) | Support email and creator attribution | Merged |
| [#147](https://github.com/primusco20/nasrinAI/pull/147) | FAQ links to in-app Help & Support | Merged |
| [#146](https://github.com/primusco20/nasrinAI/pull/146) | Isolated improvement review and deletion lineage | Merged |
| [#145](https://github.com/primusco20/nasrinAI/pull/145) | Fail-closed improvement-example redaction and eligibility | Merged |
| [#144](https://github.com/primusco20/nasrinAI/pull/144) | Responsive standalone HTML FAQ | Merged |
| [#143](https://github.com/primusco20/nasrinAI/pull/143) | Private improvement-example storage and expiry | Merged |
| [#142](https://github.com/primusco20/nasrinAI/pull/142) | Improvement consent safeguards and support contacts | Merged |
| [#141](https://github.com/primusco20/nasrinAI/pull/141) | Markdown-to-HTML downloads and support contact | Merged |
| [#140](https://github.com/primusco20/nasrinAI/pull/140) | Legal links in assistant replies | Merged |
| [#139](https://github.com/primusco20/nasrinAI/pull/139) | Consented improvement-cache safeguards documentation | Merged |
| [#138](https://github.com/primusco20/nasrinAI/pull/138) | Retention cleanup retry | Merged |
| [#137](https://github.com/primusco20/nasrinAI/pull/137) | Retention cleanup documentation | Merged |
| [#136](https://github.com/primusco20/nasrinAI/pull/136) | Configured image expiry | Merged |
| [#135](https://github.com/primusco20/nasrinAI/pull/135) | Link-reader SSRF checks | Merged |
| [#134](https://github.com/primusco20/nasrinAI/pull/134) | Switch-account chevron alignment | Merged |
| [#133](https://github.com/primusco20/nasrinAI/pull/133) | Remove legacy demo-auth server entry point | Merged |
| [#132](https://github.com/primusco20/nasrinAI/pull/132) | Composer gradients and opacity | Merged |
| [#131](https://github.com/primusco20/nasrinAI/pull/131) | Composer background colors | Merged |
| [#130](https://github.com/primusco20/nasrinAI/pull/130) | Reveal composer controls together | Merged |
| [#129](https://github.com/primusco20/nasrinAI/pull/129) | Animate composer controls together | Merged |
| [#128](https://github.com/primusco20/nasrinAI/pull/128) | Voice mute-button animation | Merged |
| [#127](https://github.com/primusco20/nasrinAI/pull/127) | NasrinAI Space galaxy logo animation | Merged |
| [#126](https://github.com/primusco20/nasrinAI/pull/126) | Welcome action buttons timing | Merged |
| [#125](https://github.com/primusco20/nasrinAI/pull/125) | Composer border consistency | Merged |
| [#124](https://github.com/primusco20/nasrinAI/pull/124) | Cloud logo tile background and centering | Merged |
| [#123](https://github.com/primusco20/nasrinAI/pull/123) | Matte-glass composer and dark theme | Merged |
| [#122](https://github.com/primusco20/nasrinAI/pull/122) | Revert PR #120 chat UI | Merged |
| [#121](https://github.com/primusco20/nasrinAI/pull/121) | Cloud logo reference and adaptive tile | Merged |
| [#120](https://github.com/primusco20/nasrinAI/pull/120) | Chat welcome screen and composer borders | Merged |
| [#119](https://github.com/primusco20/nasrinAI/pull/119) | Cloud app logo centering | Merged |
| [#118](https://github.com/primusco20/nasrinAI/pull/118) | Composer glass borders and corner gradients | Merged |
| [#117](https://github.com/primusco20/nasrinAI/pull/117) | Cloud logo in NasrinAI Space | Merged |
| [#116](https://github.com/primusco20/nasrinAI/pull/116) | Remove composer top-edge highlight | Merged |
| [#115](https://github.com/primusco20/nasrinAI/pull/115) | Crisp vector Cloud logo | Merged |
| [#114](https://github.com/primusco20/nasrinAI/pull/114) | NasrinAI Space branding and adaptive Cloud logos | Merged |
| [#113](https://github.com/primusco20/nasrinAI/pull/113) | Add files via upload | Merged |
| [#112](https://github.com/primusco20/nasrinAI/pull/112) | Library sheet layout UX | Merged |
| [#111](https://github.com/primusco20/nasrinAI/pull/111) | Library production layout | Merged |
| [#110](https://github.com/primusco20/nasrinAI/pull/110) | Library padding, copy, and categories | Merged |
| [#109](https://github.com/primusco20/nasrinAI/pull/109) | Library sheet layout and filtering | Merged |
| [#108](https://github.com/primusco20/nasrinAI/pull/108) | Connect logo and adaptive Space icon backgrounds | Merged |
| [#107](https://github.com/primusco20/nasrinAI/pull/107) | Confirm before logging out | Merged |
| [#106](https://github.com/primusco20/nasrinAI/pull/106) | Adaptive Connect logo for light/dark UI | Merged |
| [#105](https://github.com/primusco20/nasrinAI/pull/105) | Startup crash, tier picker, and sign-in | Merged |
| [#104](https://github.com/primusco20/nasrinAI/pull/104) | Keep tier picker visible on model-catalog failure | Merged |
| [#103](https://github.com/primusco20/nasrinAI/pull/103) | Revert tier-picker/sign-in fallback | Closed, not merged |
| [#102](https://github.com/primusco20/nasrinAI/pull/102) | Revert stale-session tier-picker fix | Closed, not merged |
| [#101](https://github.com/primusco20/nasrinAI/pull/101) | Revert UI/account/Space cleanup | Closed, not merged |
| [#100](https://github.com/primusco20/nasrinAI/pull/100) | Keep tier picker visible during provider outages | Merged |
| [#99](https://github.com/primusco20/nasrinAI/pull/99) | Safari OAuth PKCE cookie and independent tier loading | Merged |
| [#98](https://github.com/primusco20/nasrinAI/pull/98) | iPhone Safari Google sign-in and AI tiers | Merged |
| [#97](https://github.com/primusco20/nasrinAI/pull/97) | Recover tier picker after stale session | Merged |
| [#96](https://github.com/primusco20/nasrinAI/pull/96) | Tier picker and resilient sign-in fallback | Merged |
| [#95](https://github.com/primusco20/nasrinAI/pull/95) | UI, account, and Space cleanup | Merged |
| [#94](https://github.com/primusco20/nasrinAI/pull/94) | Monochrome app grid in NasrinAI Space | Merged |
| [#93](https://github.com/primusco20/nasrinAI/pull/93) | Photo attachments and multi-format file creation | Merged |
| [#92](https://github.com/primusco20/nasrinAI/pull/92) | Account and NasrinAI Space settings | Merged |
| [#91](https://github.com/primusco20/nasrinAI/pull/91) | Secure product knowledge | Merged |


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
