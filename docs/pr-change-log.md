## Proposed PR — Remove legacy food-ordering reference

- **Owner request (2026-10-14):** remove the obsolete food-ordering project from the current NasrinAI repository after it appeared in a domain reputation report.
- **Change:** delete `reference/crazybite-chat/`; remove its active references from the README, maintainer instructions, and roadmap; preserve the historical security findings and decision rationale without retaining the old business identity; remove the obsolete project name from the founder-knowledge test fixture.
- **Runtime impact:** no application/runtime code, routes, database, secrets, environment variables, or deployment settings changed. This does not erase old Git history and does not by itself change Gridinsoft's verdict.
- **Validation:** pending CI and review of the resulting diff.

## Proposed PR — NCC Meta channels and outbox (`feature/ncc-meta-channels`)

- **Owner request (2026-10-13):** automations post and send through Facebook, Instagram, Threads and WhatsApp (Messenger later); nothing may lose users' data or cache.
- **Change:** `src/ncc-meta.js` (official Graph, Threads and WhatsApp Cloud APIs), sealed tokens, migration `041_ncc_channels.sql` (`ncc_channels`, `ncc_outbox`; new tables only) + DB test, social steps with approval or per-step auto-send, Social screen (channels, post composer, approvals), WhatsApp from a contact; Privacy Notice 2026-10-13f (no re-acceptance).
- **Data safety:** no existing table, cache or chat code is changed. Before 041 is run the CRM keeps working (Social says not ready); account deletion skips NCC tables that are not there yet and still fails loudly on any other database error.
- **Validation:** `npm test` (fake Meta for every endpoint and the outbox), DB tests on Postgres 16, browser at 1440 px and 390 px.

## Proposed PR — NCC: its own CRM app with automations (`feature/ncc-contacts-pipeline`)

- **Owner decisions (2026-10-13):** NCC on its own subdomain (ncc.nasrinai.com), desktop and iPhone friendly, a full CRM with automation; team-enabled access; kept until the business deletes it; social channels later (Facebook, Instagram, Messenger, Threads, WhatsApp).
- **Change:** migration `040_ncc.sql` (contacts, deals, tasks, timelines, automations) + DB test; `src/ncc.js`, `src/ncc-automations.js`, `/v1/ncc/*`; the caller's verified sign-in email for the access check; Google sign-in returns to the NCC address; `/ncc/` app (`public/ncc/`) with redirect from the subdomain root (`vercel.json`, `src/http/app.js`); Space tile links to it; account export and deletion include NCC; Privacy Notice 2026-10-13e (no re-acceptance); docs.
- **Effect on the live site:** none until migration 040 is run, the domain is added and `NCC_ENABLED` / `NCC_ACCOUNTS` are set.
- **Validation:** `npm test`; DB tests on Postgres 16; browser at 1440 px and 390 px (touch): sign in, import, contact, deal drag-and-drop, tasks, automation from a template running on a new contact.

## Proposed PR — NCC logo: B · Flow (`ui/ncc-logo-flow`)

- **Owner choice (2026-10-13):** NCC logo option B, Flow (three triangles).
- **Change:** the NCC tile in NasrinAI Space shows the Flow mark (inline SVG, follows light/dark); `public/space-logos/ncc-logo-flow.svg` kept as the brand file; `docs/ncc.md`.
- **Validation:** `npm test`; browser at 390 px, light and dark.

## Proposed PR — NCC is for enterprises: contact the team (`feature/ncc-enterprise`)

- **Owner decision (2026-10-13):** NCC is separate from Connect and is for enterprises, who contact the team.
- **Change:** the NCC tile says it is the CRM with automations for enterprises, separate from Connect, not live yet, with a "Contact the NasrinAI team" link (support@nasrinai.com, subject "NCC (Nasrin Client Connect) enterprise enquiry"). `docs/ncc.md` records the decisions and the logo options.
- **Validation:** `npm test`.

## Proposed PR — Real site logos for sources (`feature/site-logos`)

- **Owner request (2026-10-13):** show each source's real site logo, to credit it (credits and copyright).
- **Change:** `GET /v1/site-icon?host=…` (`src/web/site-icon.js`, `readBytes` in `src/web/read-link.js`): our server finds the site's declared icon or /favicon.ico with the SSRF-safe reader, passes on only real raster images (no SVG), safe headers, cached a day, per-IP limit on lookups. `public/app.js`: logos on the Sources badges and next to each source (letter until it loads, and if none), plus a credit line "Logos and names belong to their sites…". Privacy Notice 2026-10-13d (does not ask anyone to accept again). `docs/web.md`.
- **Validation:** `npm test` (new `test/site-icon.test.js`: hosts, image kinds, icon order, caching, route headers, SVG refused); real lookup of github.com's icon from the sandbox; browser at 390 px with that icon and a letter fallback.

## Proposed PR — NCC tile in NasrinAI Space, plan for approval (`feature/ncc-space`)

- **Owner request (2026-10-13):** add NCC (Nasrin Client Connect), a CRM with automation like n8n and GoHighLevel, to NasrinAI Space.
- **Change:** Space tile "NCC" (people-and-steps glyph, Coming soon); tapping it says plainly it is being built and not live yet. `docs/ncc.md`: what NCC would be, the rules it must follow (tenant-scoped, AI drafts only, Confirm for outward actions, processor duties), five phases, and the owner decisions needed before the first one. No data, routes or tables yet.
- **Validation:** `npm test`.

## Proposed PR — Sources button with site badges (`ui/sources-faces`)

- **Owner request (2026-10-13, screenshot):** the sources control should look like overlapping site icons followed by "Sources".
- **Change:** `public/app.js` / `app.css`: up to three overlapping round badges (each site's first letter, first on top, shades of the ink colour) then "Sources"; the count stays in the accessible label. Real site logos are not loaded: the strict CSP allows only our own images and no third-party requests. `docs/web.md`.
- **Validation:** `npm test`; browser at 390 px, light and dark.

## Proposed PR — Softer message bubble in light mode (`ui/softer-user-bubble`)

- **Owner request (2026-10-13, screenshot):** in light mode, lessen the darkness of the person's message bubble.
- **Change:** `public/app.css`: new `--bubble` token, in light mode 76% ink mixed with the page colour (about #454545 in Mono, each palette its own); dark mode unchanged. `docs/themes.md`.
- **Validation:** `npm test`; browser: light bubble rgb(69,69,69) with white text, dark bubble unchanged.

## Proposed PR — Research citations, facts only (`feature/research-citations`)

- **Owner request (2026-10-13):** show author and citation in an organized format with a choice of citation formats; researcher-friendly, facts only (professors, researchers, students), with publication details.
- **Change:** `POST /v1/cite` (`src/web/cite.js`): the source's own publication tags (citation_*, Dublin Core, PRISM, Open Graph, JSON-LD) via the SSRF-safe reader, and Crossref's DOI record when there is a DOI; nothing found → refused, never filled in. `public/cite.js`: APA 7, MLA 9, Chicago, Harvard, IEEE, Vancouver, BibTeX from those details only. `public/app.js`: **Cite** on each web source, and "cite <link or DOI>" in the chat, show a card with the organized details, where they came from, a remembered style picker and Copy (with italics where allowed). Prompt: research answers prefer peer-reviewed/official sources and never invent authors, titles, dates, pages or DOIs. Privacy Notice 2026-10-13c (Crossref lookup; duplicate Links line removed). `docs/citations.md`, `docs/web.md`, `CLAUDE.md`.
- **Activity:** citation lookups have their own hourly allowance (`LIMIT_GUEST_CITE_HOUR` 20, `LIMIT_USER_CITE_HOUR` 120), so citing never uses up a person's web searches. The Privacy version change does not ask anyone to accept again (only a Terms change does).
- **Validation:** `npm test` (new `test/cite.test.js`); browser at 390 px: "cite <link>" card in APA then IEEE, the style remembered for a source's Cite, no author/date stated as missing.

## Proposed PR — Comparisons shown as a table (`feature/comparison-tables`)

- **Owner request (2026-10-13):** show a table when the person wants a comparison.
- **Change:** `src/ai/prompt.js` `isComparison` + `COMPARE_RULE`; `src/chat.js` adds the rule for a comparison message (and Regenerate of one): direct answer, then a Markdown table (facts only, "—" when unknown), then a short bottom line. Not in the coding chat or spoken replies. `docs/chat.md`.
- **Cache:** comparison questions get their own cache entries (`|compare` on the cache variant), so an older answer without a table is never reused; every other cache key is unchanged, so existing cache entries keep working.
- **Validation:** `npm test` (detection, prompt, chat request, Regenerate, no rule for other messages; separate cache scope, fails without the fix).

## Proposed PR — Smaller text in normal chats (`ui/chat-smaller-text`)

- **Owner request (2026-10-13):** make the fonts a bit smaller in normal chats.
- **Change:** `public/app.css`: replies 1.02 → 0.95 rem, the person's messages 1 → 0.95 rem, reply headings 1.06/0.98 → 1/0.93 rem, tables 0.9 → 0.86 rem. The coding chat keeps its own sizes.
- **Validation:** `npm test`; screenshots at 390 px before and after.

## Proposed PR — Messy file cleaner (`feature/messy-file-cleaner`)

- **Owner request (2026-10-12 backlog #2):** upload a messy Excel/CSV; get clean, organized tables and a dashboard with no data lost.
- **Change:** `public/cleaner.js` (new, browser only, no packages): reads .xlsx (shared strings, date styles, several sheets) and CSV/TSV (separator found automatically), tidies spacing, removes empty rows/columns and repeated headers, finds the header (title rows kept as notes), writes numbers/dates/percents one way (IDs with leading zeros and long digit strings left alone; ambiguous dates left as written), lists odd values and same-looking rows (never deleted), and proves every original value is accounted for. `public/app.js`: "clean/tidy/organize this" with a spreadsheet attached shows a card with the check, a dashboard, the first rows and **Download cleaned workbook** (data tabs + Summary + Changes). The file is never sent anywhere and nothing is stored. `docs/file-cleaner.md`, `docs/chat.md`.
- **Validation:** `npm test` (new `test/cleaner.test.js`: messy CSV with value check, dates, numbers, hand-made .xlsx, workbook round trip, formula text, limits; page wiring test); browser at 390 px, light and dark: no chat request made, "All 217 values accounted for", download opened again with openpyxl (real dates and numbers, IDs as text, frozen header, filters).

## Proposed PR — Web sources folded beside the reply actions (`feature/web-sources-collapsed`)

- **Owner request (2026-10-12 backlog #5):** web search with sources as links, collapsed beside the Retry button.
- **Change:** `public/format.js` `sources()` takes the "**Sources**" link list out of a web answer (http(s) only); `public/app.js` shows **Sources · n** in the reply actions, unfolding the links (site name, new tab, `noopener noreferrer`). The saved reply is unchanged, so history, copy, share and Library keep the sources; read-aloud skips them. No server or database change. `docs/web.md`.
- **Validation:** `npm test` (new tests: extraction, non-web links left alone, wiring); browser at 390 px: text without the list, button closed, tap opens two links in new tabs.

## Proposed PR — Loader while a picture, video or file is made (`ui/generation-loader`)

- **Owner request (2026-10-12 backlog #8):** a tech-style loading animation while an image, video or file is being made.
- **Change:** `genLoader` in `public/app.js`: a pixel screen lighting up in diagonal waves under a scan line, with the step and elapsed seconds. Shown while the picture itself is made (sized like the picture), while a video renders (with its %), and, slim, while a reply writes a file (replaces the "Writing your file…" text note in `public/files.js`). Element-only (CSP), `role="status"`, still with reduced motion. `docs/chat.md`.
- **Validation:** `npm test`; browser at 390 px, light and dark: the file loader appears under the text while the file is written and is gone when the reply is done.

## Proposed PR — Replies fade in; the chat stays where you read (`ui/reply-fade-no-autoscroll`)

- **Owner request (2026-10-12 backlog #9):** replies fade in; the screen stays where the user is reading instead of scrolling down.
- **Change:** `public/app.js` follows new text only while the person is at the bottom; scrolling up (wheel, finger, keys) stops it at once, scrolling back down or sending a message resumes it; streaming follows instantly instead of a smooth scroll per word. Replies fade in (`.msg.assistant.is-new`). `docs/chat.md`.
- **Validation:** `npm test`; in a browser (390 px), scrolling up mid-reply kept the position for 4 s while the reply grew (before: pulled back to the bottom); sending again followed to the end.

## Proposed PR — Smooth, bouncy, pixel-perfect busy robot (`ui/robot-smooth`)

- **Owner request (2026-10-13, screenshot):** the busy robot's turn looked like noise; make it smooth and bouncy, with a pixel-perfect turn and burst.
- **Change:** `scripts/pixelbot-logo.py` busy version (3.6 s): pops up with a bounce, the pixel grid spreads evenly (gaps, no overlap) with a bounce out and in, then shrinks. The turn now slides the face across the fixed grid (eyes and speckle move along each row and come round from the back; the light stays put) in 60 fps whole-pixel frames, so pixels never overlap or fade. Fixes the eyes, which the old busy version dropped. ~32 KB gzipped (was ~67 KB).
- **Owner follow-up:** keep it explosive; pause only at 360°. The burst now throws outer pixels further (gaps grow outwards, still no overlap) with a sharp ease-out and bounce, the face turns one full turn while burst, pauses facing front, then snaps back in with a bounce. Second follow-up: wider burst (edge thrown 1.75× its distance, wider view so nothing is cut off) and a small fixed random scatter per pixel, under half the gap so pixels never touch.
- **Validation:** `npm test`; rendered frames, light and dark.

## Proposed PR — Nasrin finds your repositories and asks which (`feature/repo-pick`, on top of #309)

- **Owner request (2026-10-13):** "check my github repository" asked for owner/repo; NasrinAI should detect the allowed repositories and ask which one.
- **Change:** `github_my_repos` tool (the connected account's repositories); coding rules: use a clear match or list them and ask; `[[repo owner/name]]` lets the page remember the project's repository (hidden), sent as `repo` with coding messages and added to the model's instructions. `docs/github.md`.
- **Validation:** `npm test`.

## Proposed PR — People stay signed in across deploys (`fix/refresh-race`)

- **Owner report (2026-10-13):** users are logged out after every merge.
- **Found (Supabase auth logs, read-only):** right after deploys (03:16, 03:53, 04:16 UTC) the same refresh token reached Supabase 2–4 times within seconds → `refresh_token_already_used` ("possible abuse") → the session is revoked.
- **Change:** the page refreshes one at a time across tabs (Web Locks); the server answers a repeated refresh token (within 20 s) with the first answer instead of calling Supabase again. `docs/sign-in.md`.
- **Validation:** `npm test` (three refreshes at once → one Supabase call, same new cookie for all; a later retry gets it too; failures not shared).

## Proposed PR — Robot turns, grows and bursts while busy (`ui/robot-burst`)

- **Owner request (2026-10-13):** the busy robot rotates, starts smaller, grows bigger and explodes, like connecting to its sources.
- **Change:** `scripts/pixelbot-logo.py` busy version: the ball grows from small, its pixels burst further out and return while it spins horizontally once (only during the burst; owner follow-up), pauses, turns back into its normal form and shrinks (3.2 s cycle). The turn is a 3D sphere like a globe (owner follow-up): each pixel moves along its row of the ball, a copy on the back comes into view, edges are shaded; ~67 KB gzipped. Two more robot moods for the thinking line: **Remembering** (a ripple of light through the pixels; Remembering, Checking your Library, Reading) and **Writing** (rows fill in like typing; Writing code, Writing, Putting it together); other stages use the burst. SMIL, CSP-safe; still version for reduced motion.
- **Validation:** `npm test`; rendered frames (small → big → burst → back).

## Proposed PR — Coding replies no longer fail after a GitHub lookup (`fix/gemini-tool-rounds`)

- **Owner report (2026-10-13):** in the coding chat, "create a prototype financial tracker in my repository" → "NasrinAI cannot answer right now".
- **Found (live usage records, read-only):** each try: Gemini asks for `github_list_files` (ok) → the tool runs (ok) → the next Gemini call fails in under a second (`provider_error`), five times. Earlier, OpenAI did the same flow fine. Gemini 3 sends a thought signature with each tool call (`extra_content` on the OpenAI-compatible endpoint) and refuses the follow-up without it; NasrinAI dropped it.
- **Change:** tool calls keep `extra_content` and send it back (`src/ai/tool-format.js`); if a model still refuses a tool round (400), the tool results go back as plain text marked as data and it answers without more tools (`flattenToolTurns` in `src/chat.js`).
- **Validation:** `npm test` (signature kept and returned; refusal → answer from text).

## Proposed PR — Up to 10 GitHub accounts (`feature/github-accounts`)

- **Owner request (2026-10-13):** "Add account" in GitHub settings, up to 10 accounts.
- **Change:** migration 039 (key `tenant_id, user_id, login`; `is_main`; one main per person; at most 10, enforced by a trigger) + DB test; store list/main/delete-one; routes `?add=1`, `POST /v1/github/main`, `DELETE /v1/github?login=`; Settings lists accounts with Main / Make main / Remove, Add account, Reconnect main account, Disconnect all. Privacy `2026-10-13b`.
- **Owner step:** run `db/migrations/039_github_accounts.sql` in Supabase **before** merging.
- **Validation:** `npm test`, DB tests (incl. upgrade of an existing connection), headless Chromium.

## Proposed PR — Connected plugins first (`ui/plugins-connected-first`, on top of #304)

- **Owner request (2026-10-13):** all connected apps are listed at the top of Plugins.
- **Change:** a **Connected** group at the top holds every connected plugin (now GitHub); when disconnected it moves back to its group (Developer). `docs/plugins.md`.
- **Validation:** `npm test`; headless Chromium (connected → top; disconnect → back down).

## Proposed PR — Plugin row with actions and a Settings page (`ui/plugin-details`, on top of #303)

- **Owner request (2026-10-13):** instead of the message and buttons, an expand row with Choose repositories, Disconnect/Reconnect and Settings; Settings like the reference (header card, Permissions, Connected account, Information).
- **Change:** GitHub is one row (icon, name, connected @name) that expands to Choose repositories, Reconnect, Settings, Disconnect. Settings: header card with what it does; Permissions (Open pull requests automatically); Connected account (@name, Reconnect, Disconnect); Information (Category, Developer, Website, Privacy Policy, Report an issue → Help & support).
- **Validation:** `npm test`; headless Chromium (light/dark).

## Proposed PR — More plugins listed (`feature/more-plugins`, on top of #302)

- **Owner request (2026-10-13):** add Outlook, OneDrive, Teams, Excel, PowerPoint, Canva; Gmail, Google Cloud, Google Meet, Google Calendar; Facebook, Instagram, Threads, X, Messenger, WhatsApp.
- **Change:** the Plugins sheet lists them in three groups (Microsoft, Google, Social) as **Coming soon** with plain glyphs; nothing connects yet. `docs/plugins.md` says what each real plugin needs.
- **Validation:** `npm test`; headless Chromium.

## Proposed PR — PR descriptions, automatic pull requests, many-file card (`feature/auto-pr`)

- **Owner request (2026-10-13):** NasrinAI writes the pull request's comments and documentation (summary, steps); an option for automatic pull requests; more than 5 files are not shown in the chat but go to a pull request.
- **Change:** PR description from the reply (Summary, Files, What was done, Steps needed, Check before merging); a check comment on each PR; **Open pull requests automatically** in Plugins → GitHub (`prefs.autoPr`, server-checked); replies with more than 5 files show one card; coding rules ask for code comments and README/docs updates. Terms and Privacy `2026-10-13`.
- **Validation:** `npm test`; headless Chromium.

## Proposed PR — Code chats in the menu, pixel robot, Space tiles (`ui/space-code-polish`)

- **Owner request (2026-10-13):** coding chats and normal chats in the menu; the robot breaks into pixels and comes back while Nasrin thinks, remembers or writes code; no background behind the robot (header and thinking line); every Space app on the same tile, not too dark in dark mode.
- **Change:** menu → Recent has **Chats** and **Code** tabs; a coding chat opened from it reopens in the coding chat and its project (which chats are coding chats is kept on this device). `scripts/pixelbot-logo.py` regenerates the robot without its tile; the busy version scatters every pixel and reassembles (SMIL, CSP-safe, ~11 KB gzipped). Space icons share one tile (#ECEBE7 light, #3A3A3C dark); Connect and Projects lose their built-in black tiles; Movo gets a wallet glyph.
- **Validation:** `npm test`; headless Chromium (light/dark, menu tabs, reopen in coding chat, animation frames).

## Proposed PR — Reliable repository coding (`feature/coding-engine`)

- **Owner request (2026-10-13):** audit the repository read/write capability and turn it into a reliable coding workflow (real files, verified writes, tests, honest status).
- **Audit:** capability table in `docs/github.md` (verified by tests / unavailable / unverified live).
- **Change:** exact SEARCH/REPLACE changes to existing files (applied only where the text still matches once, so stale files are never overwritten); unchanged files skipped; saved files read back from the new branch and compared (`verified`); a repeated request returns the open PR; a saved branch without a PR is reported by name; `github_search_code` and `github_pr_status` (PR state, files, CI checks) tools; coding rules: read real code first, send changes not rewrites, report checks only from `github_pr_status`.
- **Owner step (optional):** GitHub App permissions → Checks: Read-only, Commit statuses: Read-only (for CI results).
- **Validation:** `npm test`; headless Chromium.

## Proposed PR — Plugins always visible, GitHub settings check (`fix/github-status`)

- **Owner report (2026-10-13):** Plugins is not showing.
- **Cause:** Plugins was hidden until GitHub is on (all GitHub settings valid and `CONNECTOR_SECRET_KEY` set, then a redeploy).
- **Change:** Plugins is always in the menu; the GitHub card says when GitHub is not switched on yet. `/v1/status` shows `github.available` or `github.off` (the missing setting's name, never a value). The slug may be pasted as the whole public link or with capitals; quotes around values are dropped.
- **Validation:** `npm test`; headless Chromium.

## Proposed PR — Plugins in the menu (`feature/github-menu`)

- **Owner request (2026-10-13):** put the GitHub plug-in in the menu instead of the project picker, named "Plugins".
- **Change:** a **Plugins** item in the menu (under Code) and in the desktop side bar opens the Plugins sheet with GitHub as its first plugin (Connect / Disconnect, Choose repositories, the connected @name). Shown only when GitHub is set up; guests are asked to sign in. Removed from the project picker. `docs/github.md`.
- **Validation:** `npm test`; headless Chromium (390 px light, 1280 px dark).

## Proposed PR — GitHub in the coding chat (`feature/github`)

- **Owner request (2026-10-12):** full GitHub repository management for coding: read code, pull updates, push changes or pull requests. Owner choices: built-in `fetch` (not Octokit, ADR-002), a GitHub App with user sign-in (OAuth), read + pull requests only after Confirm.
- **Change:** `src/github/` — REST client (read repo, folders, files in parts, commits; pull request = new `nasrin/…` branch + one commit + PR, never touching existing branches), GitHub sign-in (signed state + one-time cookie, tokens sealed with `CONNECTOR_SECRET_KEY`, refreshed before expiry, revoked on disconnect), routes `/v1/github/*`, four read-only model tools. Coding chat: Connect GitHub in the project picker; "Open pull request" under replies with files → Confirm sheet. Migration `038_github_connections.sql` (server-only table) + DB test. Privacy `2026-10-12h`, Terms `2026-10-12b`. `docs/github.md`.
- **Owner steps:** create the GitHub App, set three Vercel env vars, run migration 038 (staging first) — see `docs/github.md`.
- **Validation:** `npm test`, DB tests, secret scan, headless Chromium.

## Proposed PR — Busy pixel robot on the coding thinking line (`ui/code-thinking`)

- **Owner request (2026-10-12):** in the coding chat the thinking avatar uses the pixel robot, with a more aggressive animation while thinking, remembering, etc.
- **Change:** `code-bot-{light,dark}-busy.svg` (same robot, about 4× faster sweep, blinks and twinkle) made by `scripts/pixelbot-logo.py`; the coding chat's thinking line shows it instead of the Nasrin ball; still version when motion is reduced. Normal chats keep the ball.
- **Follow-up (owner):** no question cards ("Your answer" boxes) in the coding chat: no `[[ask]]` rule there, one plain-sentence question at most, and a stray block becomes plain text.
- **Validation:** `npm test`; headless Chromium (light and dark).

## Proposed PR — Google sign-in completes (`fix/google-signin-stale-cookie`)

- **Owner report (2026-10-12):** Google sign-in fails after choosing the account.
- **Found (Supabase auth logs):** Google accepts the person (13:35 and 17:20 UTC) but our server never exchanges the code; the page keeps the previous session (an old refresh token, "already used"). Supabase falls back to the Site URL (`/?code=…`) when `/v1/auth/google/callback` is not in its Redirect URLs list, and the home page ignored the code.
- **Change:** the page forwards `?code=` to the callback on the same site (the PKCE cookie still guards it); the "repeated answer" shortcut now applies only when no code arrived, so a code without its PKCE cookie is a failure, never a silent "ok" with an old session. `docs/sign-in.md`.
- **Owner step:** Supabase → Authentication → URL Configuration → Redirect URLs: add `https://nasrinai.com/v1/auth/google/callback` and `https://www.nasrinai.com/v1/auth/google/callback`.
- **Validation:** `npm test`; headless Chromium (`/?code=…` → callback).

## Proposed PR — Pixel-robot logo for the Code chat (`ui/code-logo`)

- **Owner request (2026-10-12):** the supplied pixel robot is the new Code chat logo.
- **Change:** four SVGs in `public/space-logos/` (light/dark, animated/still), converted by `scripts/pixelbot-logo.py` so they need no inline styles (strict CSP); shown in the coding top bar (instead of the Nasrin ball), on Space → Coding and in the project picker; CSS picks theme and still versions. Metadata from the source files removed.
- **Follow-up (owner):** the home screen (ball, greeting, starter buttons) is hidden in the coding chat.
- **Validation:** `npm test`; headless Chromium with the CSP Vercel sends (logo coloured and animated, light and dark).

## Proposed PR — Phones always get the newest app files (`fix/fresh-app-files`)

- **Owner report (2026-10-12):** after #283/#288 were live, the project list had no expand arrow and Code in the menu did nothing.
- **Found:** the latest `main` works in a browser (arrow → Open, Chat, Code; Code → project picker). The phone showed the new menu (from a fresh page) with an older `app.js`: script and styles could be kept for an hour (`max-age=3600` in `src/http/static.js`) while the page was always fresh, so new buttons had no code behind them.
- **Change:** the page, `app.js`, `app.css`, other scripts and the manifest are revalidated on every load (`Cache-Control: no-cache` with an ETag, so unchanged files answer 304); the same rule is set for Vercel's CDN in `vercel.json`. Pictures are still kept for an hour.
- **Validation:** `npm test` (headers, 304, Vercel rule).

## Proposed PR — Lighter type everywhere (`ui/lighter-type`, on top of #290)

- **Owner request (2026-10-12):** lessen the bold fonts across the app.
- **Change:** every heavy weight goes down: 700–900 → 600, 550–650 → 500 (so fonts without in-between weights never fall back to bold); `b`, `strong`, `th` and headings default to 600 instead of the browser's 700. App, shared-chat page, voice glass, FAQ and professional registry pages. PDF/Word downloads keep their bold.
- **Validation:** `npm test`; headless Chromium screenshots; no horizontal scroll at 320–1280 px.

## Proposed PR — Premium coding replies (`feature/coding-replies`, on top of #288)

- **Owner request (2026-10-12):** smaller, different fonts in coding; premium replies with icons that match the meaning (green outline check for success, shield for secured, ✕ for failed); a super simple summary of the work.
- **Change:** `[[checks title="…"]]` status lists (status | item | badge) with outline icons and coloured badges; status emoji at the start of a line become the same icons; coding mode uses a compact type scale; the coding rule asks for a one-line result first and a simple status summary last (never claiming tests passed without proof). Copy, read-aloud and spoken replies turn rows into plain words; while streaming the block tags are hidden.
- **Follow-up (owner):** the project button is now only a folder icon; the project's name sits under "Nasrin" at the top center.
- **Files:** `public/format.js`, `public/files.js`, `public/app.css`, `src/coding.js`, `src/ai/speech-text.js`, tests, `docs/coding-chat.md`.
- **Validation:** `npm test`; headless Chromium screenshots (dark and light, coding and normal chat).

## Proposed PR — Coding chat (`feature/coding-window`)

- **Owner request (2026-10-12):** a dedicated coding chat. Code under Library in the menu; a window to choose or create a project first; a top bar with the project and leave (right) and the menu (left); Professional AI becomes coding experts (automatic).
- **Change:** `Code` in the phone menu and desktop rail (also Start coding, Space → Coding, a project's Code); project picker sheet with create; coding mode in the header; pill "Code experts" sending the Technology group; `coding: true` adds `CODING_RULE` + new `CODING_CHAT_RULE`, keeps code files as their real type and skips the answer cache. `docs/coding-chat.md`, `CLAUDE.md` map.
- **Data:** none new (coding chats are project chats); no legal change.
- **Validation:** `npm test` (coding rules, files kept, flag check); headless Chromium at 390/1280 px (pick/create project, coding bar, Code experts, request carries `coding` + project + group, survives reload, switch, leave); no horizontal scroll at 320–1280 px.

## Proposed PR — One Library icon (`ui/library-icon`)

- **Owner request (2026-10-12):** use the Library app icon (bars with a dot and a base line) for Library everywhere, theme-adaptive, no background.
- **Change:** one inline glyph (`svg.lib-glyph`, `currentColor`, two bars at half strength) in the menu, the tab bar and the NasrinAI Space tile; no badge background, follows light/dark and palettes.
- **Validation:** `npm test`; headless Chromium screenshots in light and dark (menu and Space).

## Proposed PR — Projects in NasrinAI Space (`ux/space-projects`)

- **Owner report (2026-10-12):** the project expand features (#283) seem missing.
- **Found:** #283 is live and works (checked in a browser: arrow → Open, Chat, Code), but NasrinAI Space had no Projects tile, so projects were only under Menu → Projects. Also the "Go to your space" starter did nothing visible: it switched pages inside the closed Settings sheet.
- **Change:** a Projects tile in NasrinAI Space (hidden when Projects are off) opens Your projects; the starter opens Settings first, then Space. New icon `public/space-logos/icon-projects.svg` in the Library icon's style. `docs/projects.md`.
- **Validation:** `npm test`; headless Chromium at 390 px and 1280 px (starter → Space → Projects tile → Your projects).

## Proposed PR — Replies keep going when you open another chat (`fix/background-chat-switch`)

- **Owner report (2026-10-12):** an ongoing reply should not be interrupted when another chat is started.
- **Found:** New chat already let the reply finish (#281, checked in a browser), but opening another chat from Your chats or the menu was ignored or stopped the reply, and a project's Chat/Code buttons did nothing while a reply was running.
- **Change:** one `detachTurn()` used by New chat, opening a chat and project Chat/Code; the earlier reply finishes and is saved in its own chat, with the same notice. `docs/chat.md`.
- **Validation:** `npm test`; headless Chromium at 390 px and 1280 px: open another chat while a slow reply runs → both chats saved with their replies, composer free.

## Proposed PR — Google sign-in waits for the security check (`fix/google-signin-check`)

- **Owner report (2026-10-12):** Google sign-in does not work and keeps asking to complete the security check.
- **Cause:** the Cloudflare check runs invisibly and takes a few seconds; tapping the button before it finished failed at once with "Complete the security check first". After coming back from Google with Back, the button stayed disabled.
- **Change:** sign-in (Google and email code) waits up to 20 s for the check, shows "Checking your connection is secure…", and shows a clear message if Cloudflare reports an error; Back from Google re-enables the button with a fresh check. `docs/sign-in.md`.
- **Follow-up (owner: "the sign in for google did not go through"):** Supabase auth logs show the Google sign-up succeeded at 15:57:13 UTC, then the same answer arrived again at 15:57:14 ("State has already been used"), and the page showed the failure. The callback now keeps an existing sign-in when the answer repeats, and the page shows "did not finish" only when really signed out.
- **Validation:** `npm test`; headless Chromium with a stubbed Turnstile (slow success → request sent with the token; error → clear message).

## Proposed PR — Documents download as PDF (`fix/doc-file-types`)

- **Owner request (2026-10-12):** a meal plan and shopping list came as an `.html` download; documents should be PDF (or Word, etc.), `.html` only for coding.
- **Change:** the prompt makes documents `.pdf` by default (`.docx` to edit) and keeps `.html`/`.css`/`.js` for coding or an asked-for web page; `src/ai/file-types.js` converts a plain document still handed over as `.html` into a `.pdf` (headings, bullets, bold kept) unless the person's recent messages ask for web or code work. `docs/chat.md`.
- **Validation:** `npm test` (conversion, coding keeps `.html`, prompt, saved chat reply).

## New chat without interrupting an ongoing reply

- Starting a new chat detaches the active reply from the current composer without aborting its request.
- The previous reply continues against its original conversation and project context, and is persisted on the server; it never renders into the new chat.
- The new chat immediately becomes usable for another request. Completion of an older request cannot overwrite the new conversation ID or clear the new turn's busy state.
- Existing request cancellation remains available for the active visible turn. No database, quota, or authorization changes.

## Exact project card layout from reference

- Render Open, Chat, and Code as three equal-width vertical cards in a single row when a project is expanded.
- Each card uses a centered monochrome outline icon, bold title, and muted two-line description; thin gray border and rounded corners on a matte charcoal/theme-adaptive surface.
- Project heading uses a folder-with-bars outline icon and a chevron that flips upward when expanded.
- Add a narrow-screen layout adjustment and retain keyboard focus and reduced-motion support.

## Reference-matched project action styling

- Match the supplied illustration with a matte theme-adaptive panel, rounded outline, generous row spacing, monochrome line icons, and subtle separators.
- Add a folder icon to project rows and use matching folder, chat-bubble, and code icons for Open, Chat, and Code actions.
- Preserve light/dark theme tokens and reduced-motion behavior; no new accent colors except existing theme semantics.

## Expandable project actions

- Each project row has an accessible expand/collapse control revealing Open, Chat, and Code actions.
- Open shows the existing project details view. Chat starts a new conversation scoped to the selected project. Code starts a project-scoped chat and pre-fills an editable coding prompt; it does not auto-submit.
- Keep the existing project detail view and its New chat action working through the same project-chat helper.
- Respect reduced-motion preferences for the expansion animation. No API, database, RLS, authorization, quota, or environment changes.

## CI follow-up — gallery focus selector

- CI exposed a theme audit failure because `.image-gallery-more:focus-visible` referenced `var(--accent)` outside a theme-scoped selector.
- Use `currentColor` for the keyboard focus outline instead. This preserves a visible focus indicator without adding an unscoped theme accent reference.

## Smooth generated-image entrance animation

- Replace the hard pulsing image placeholder with a restrained, low-contrast shimmer while the saved image is fetched.
- Reveal the actual image only after its `load` event, using a 560 ms opacity fade with a subtle upward settle and blur-to-sharp transition.
- Register the load handler before assigning `src`, avoiding a race with fast/cached loads.
- Honor `prefers-reduced-motion`; preserve the existing owner-checked image fetch, download, regenerate controls, and gallery behavior.

## PR #278 follow-up — Generated picture gallery

- Preserve the current full-size image presentation for 1–10 generated pictures.
- For more than 10, render a responsive 3-column × 3-row gallery: eight square thumbnails and a **Show more** tile in the ninth slot. Each press appends the next eight pictures and keeps the next Show more tile until all results are visible.
- Keep each picture's existing owner-checked `/v1/images/:id` fetch and download action.
- Raise the recall response cap from 12 to 100 retained generated pictures so Show more can page through a larger history.
- No schema, RLS, credentials, token limits, or retention settings changed.

## Proposed PR — Fix natural-language recall of generated Library pictures

- **Owner report (2026-10-12):** “show me the pictures generated in the library” received generic navigation instructions instead of the saved pictures.
- **Cause:** the recall detector required “my/previous/past/generated” before “pictures/images”, or “pictures I generated”; it did not match the ordinary phrase “pictures generated in the Library”.
- **Change:** use a dedicated, tested intent detector that accepts natural word order and Library/history/saved wording. The existing signed-in check, account-scoped storage listing, retention rules, and owner-checked image endpoint remain unchanged.
- **Validation:** regression tests cover the reported wording, related phrasings, and unrelated image requests. Run full CI and verify the deployed Library on iPhone Safari before treating production as fixed.

## Proposed PR — Simple internet-data check (`ops/internet-data-check`)

- **Owner request (2026-10-12):** a file to run in Supabase to see what NasrinAI stored from the internet.
- **Change:** `db/ops/check_internet_data.sql` (read-only): one table with a summary row (answers kept, last 24 h, web searches today, facts waiting for review) and the 20 newest internet answers; optional parts for web-search health, research facts and one full answer.
- **Validation:** main query run read-only against production (returns the summary plus saved answers).

## Proposed PR — Web search runs again (`fix/web-search-on`)

- **Owner report (2026-10-12):** "what is the latest news" got "I can't check live news"; "can you browse the internet?" got "I do not have the ability".
- **Cause:** the web search model (`gpt-6-luna`) lost its price when `config/model-prices.json` was updated; in production an unpriced model makes the spend check skip every search silently. `usage_events` shows the last web search on 2026-10-11 03:38 UTC.
- **Change:** default `WEB_SEARCH_MODEL` is `gpt-5.4-mini` (priced); an unpriced setting falls back with a start-up warning. With search on, the prompt says NasrinAI can search the internet and never claims it cannot browse; "can you browse the internet?" is answered without spending a search. More news wording triggers search ("headlines", "search the internet…").
- **Follow-up (owner, 2026-10-12):** "NasrinAI must not show its flaws; if internal knowledge is unavailable it scans the internet." A draft that admits it lacks current facts now triggers the web search and is replaced; "new update about…", "any updates on…", "recent", "ongoing" also search; a search without sources falls back to the regular answer instead of an apology; news questions are answered directly, no clarifying card first.
- **Files:** `src/config.js`, `src/web/search.js`, `src/ai/prompt.js`, `src/chat.js`, `test/web-search-model.test.js`, `test/web.test.js`, `docs/web.md`, `.env.example`.
- **Validation:** `npm test`.

## Proposed PR — Toolbar loads together (`ux/load-together`)

- **Owner request (2026-10-12):** all buttons responsive and loading together; more user-friendly.
- **Audit:** headless Chromium clicked every control (phone 390 px: main, menu drawer, Settings; desktop 1280 px; guest and signed in): no broken buttons. Startup timing with slowed API calls found three late changes: the Professional AI button said "Automatic", then switched to "Universal AI" about 3.5 s later; "Sign in" appeared after the status check; "Your chats" became "Your chats and Library" after load.
- **Change (`public/app.js`, `public/index.html`):** the public profession list is requested at once (no longer behind status and sign-in) and kept on the device, so the button shows the right choice at first paint; the placeholder follows the saved choice (off = "Universal AI"); "Sign in" shows immediately when this device has no sign-in; the Library label remembers the last server answer. No personal data is stored (public list and an on/off flag).
- **Validation:** `npm test`; headless Chromium: all toolbar and header buttons appear in the same frame (~240 ms) with their final labels; click crawl unchanged.

## Proposed PR — Research findings kept as web answers too (`fix/web-answers-all-tiers`)

- **Owner request (2026-10-12):** every reply from internet sources is kept permanently, on every tier. Chat (web search, shared links) already saved on all tiers through `finish()`; the research agent's findings did not reach `web_answers`. Now they do (facts as the answer, their pages as sources; question only for signed-in people).
- **Validation:** `npm test`.

## Proposed PR — Science and Media professions (`feature/professions-science-media`)

- **Owner request (2026-10-12):** new Professional AI models for Science (researcher, biologist, chemist…) and Multimedia (broadcaster, news anchor, reporter…).
- **Change:** two groups and ten professions in `src/ai/professions.js`, with two safety rules (`science`, `journalism`); everyday words that would mis-route Automatic mode left out. The page reads the catalog, so no UI change. `docs/professional.md`.
- **Validation:** `npm test` (routing examples and safety text in the prompt).

## Proposed PR — Thinking line sets expectations (`ui/thinking-status`)

- **Owner request (2026-10-12):** the "Thinking" line should say what is happening (browsing the internet, remembering, cooking, making your…, almost done).
- **Change:** the chat stream sends a fixed status word (`files`, `links`, `library`, `memory`, `web`; never free text) as Nasrin starts each step; the page shows "Reading your file", "Reading the link", "Checking your Library", "Remembering", "Browsing the internet". Before that it guesses from the message (e.g. "Cooking up an answer", "Writing code", "Making your plan"), then shows "Putting it together" after 7 s and "Almost done" after 16 s. Gentle fade; reduce-motion respected.
- **Files:** `src/chat.js`, `src/routes.js`, `public/app.js`, `public/app.css`, `test/chat-stream.test.js`.
- **Validation:** `npm test`; headless Chromium (news → "Browsing the internet", recipe → "Cooking up an answer").

## Proposed PR — Library only when asked (`fix/library-tag`)

- **Owner report (2026-10-12):** a greeting got "From your Library: Hello again! How can I help you today?" (a saved reply matched the words).
- **Change:** `src/library.js` uses the Library (and the reply names it) only when the person asks about their library, files, documents, notes, saved items, pictures, videos or uploads, or the chat is in a project. Privacy notice `2026-10-12g`; `docs/library.md`.
- **Validation:** `npm test` (greeting and general question no longer use the Library; explicit and project cases still do).

## Proposed PR — Simple setup check (`ops/setup-check`)

- **Owner request (2026-10-12):** one simple, read-only SQL file to check the Supabase setup.
- **Change:** `db/ops/check_setup.sql`: a ✅/❌ list (answer cache, upload bucket private and any type, research tables and clean-up, web answers) with the file to run for each ❌; optional row counts.
- **Validation:** run against a Postgres 16 with all migrations and a `storage.buckets` stand-in: all ✅.

## Proposed PR — Privacy and Terms update, with #265, #266 and #267 combined (`legal/oct12-update`)

- **Owner request (2026-10-12):** update the Privacy Notice and Terms of Use. This branch merges #265 (research), #266 (semantic cache) and #267 (web answers) so the legal pages are updated once, consistently.
- **Privacy `2026-10-12f`:** answer cache (30 days, per person), research (private scans; shared reviewed facts without who asked), web answers kept permanently without identity, direct uploads; summary bullet added.
- **Terms `2026-10-12`** (signed-in people accept again): research reads public pages only and honours robots.txt; answers built from the internet are kept permanently without identity and may answer others; answer cache.
- **Validation:** `npm test`, `npm run check:secrets`.

## Proposed PR — Semantic cache fills again (`fix/semantic-cache`)

- **Owner report (2026-10-12):** `public.semantic_cache` has 0 rows.
- **Cause:** embeddings came from an on-device model (`@huggingface/transformers`) that cannot load on Vercel; every lookup failed before reaching Supabase (Supabase API logs: no `match_semantic_cache` calls in 24 h), so nothing was ever stored.
- **Change:** embeddings from OpenAI `text-embedding-3-small` with 384 dimensions (fits the existing column) through plain fetch, contact details removed first; the package and `src/embedder.js` are removed; the warning now says why a lookup failed. Needs `OPENAI_API_KEY` (already set for chat).
- **Data:** privacy notice `2026-10-12d` now describes the answer cache (30 days, per person) and the embedding call.
- **Validation:** `npm test`, `npm run check:secrets`.

## Proposed PR — Research agent (`feature/research-agent`)

- **Owner request (2026-10-12):** an agent that reads web pages for a question and stores the facts in Supabase; owner approved the safe version (no package, robots.txt honoured, nothing bypassed; scans private per person; shared facts hold fact + source only, pending review).
- **Change:** `POST/GET /v1/research`, `src/research.js`, store methods, limiter, hourly purge, export/delete, `/v1/status` `research`. Off until `RESEARCH_ENABLED=true`.
- **Data:** privacy notice `2026-10-12c` (scan keep-times; shared facts without question or identity).
- **Owner steps:** run migration 036 (staging first), set `RESEARCH_ENABLED=true`, redeploy; review `research_facts`.

## Proposed PR — Web-sourced answers kept permanently (`feature/guest-no-store-web-answers`)

- **Owner decision (2026-10-12, revised):** guests' input stays 24 hours as before; NasrinAI replies built from internet facts (web search or a shared link's page) are kept permanently with their sources. Question kept only for signed-in people; never who asked.
- **Change:** `src/web-answers.js` + `web_answers` (migration 037); saved from `finish()` in `src/chat.js`. Privacy notice `2026-10-12e`. `docs/web-answers.md`.
- **Owner steps:** run migration 037 (staging first).
- **Validation:** `npm test`, DB tests (Postgres 16), `npm run check:secrets`.

## Proposed PR — Enable semantic cache for NasrinAI page responses

- **Incident (2026-10-12):** production `semantic_cache` remained empty after chats. Code audit found the page sends `blocks: true`, while the smart-routing cache guard excluded every block-rich non-coding response; therefore the semantic lookup and store were never reached for ordinary page chats.
- **Change:** allow block-rich requests through the existing cache policy when all other safeguards pass. Include `blocks` versus `plain` in the cache variant for non-coding requests, keeping exact and semantic entries isolated by response format. Coding variants retain actor, tier and markup isolation.
- **Safety:** no changes to token limits, database schema, RLS, cache threshold, or unrelated routing. Existing policy still excludes sensitive requests, attachments, extra context, tools, voice, code files, regenerations and detected secrets.
- **Regression coverage:** run awaited-write and non-fatal-insert-failure tests with `blocks: true`, matching the NasrinAI page request shape.
- **Validation:** CI must pass `npm test` and `npm run check:secrets`; verify production row counts only after merge and deployment.

## Proposed PR — Wire the HNSW semantic cache into chat

- **Owner request (2026-10-12):** connect the existing Supabase HNSW semantic cache to the active chat flow without changing unrelated behavior.
- **Change:** initialize the existing semantic-cache implementation in `src/main.js` with the server-only Supabase secret and local `Xenova/all-MiniLM-L6-v2` embedder; pass it to `src/chat.js` as a second-level cache after the existing exact-match policy cache.
- **Safety:** semantic lookup runs only when the existing policy cache key allows the request. Scope is hashed and bound to tenant, actor, plan tier, task, level and output variant. Cache failures fall through to the normal model path; cached responses are touched and logged as zero-cost cache hits. No token limits, SQL, RLS, or unrelated app behavior are changed.
- **Validation:** focused semantic-cache unit tests and source-wiring regression tests, then full `npm test` and `npm run check:secrets` in CI. This change does not populate production rows until eligible chat requests occur after deployment.

## Proposed PR — Voice screen tier as an icon (`ui/tier-icon`)

- **Owner request (2026-10-12):** the voice screen's tier pill ("Pro ⌄") becomes an icon, the same signal bars as the chat's model button (one bar per level); the name stays for screen readers. Then (owner: "make the buttons same all together") all four voice controls share one size and glass look; the mic is no longer larger and black, and turns filled only while muted.
- **Files:** `public/index.html`, `public/app.js`, `public/voice-liquid-glass.css`, `test/voice-screen.test.js`.
- **Validation:** `npm test`; headless Chromium at 390 px.

## Proposed PR — Direct uploads through Supabase Storage (`feature/direct-uploads`)

- **Owner request (2026-10-12):** client-direct uploads so files are not held to Vercel's 4.5 MB request limit. Chosen: Supabase Storage signed upload links (no new package, private bucket), 20 MB per message.
- **Change:** `POST /v1/uploads` gives a one-time upload link; the page uploads files (photos stay inline) straight to the private bucket `chat-uploads`; the chat names them by id; the server reads each once, deletes it and checks it like any file. The hourly clean-up removes unused uploads. `/v1/status` → `uploads`. CSP `connect-src` adds `https://*.supabase.co`. Off until `UPLOADS_DIRECT=true`.
- **Data:** files may sit in Supabase Storage until used (at most about 2 hours if never sent). Privacy notice updated, version `2026-10-12b`.
- **Files:** `src/uploads.js`, `src/config.js`, `src/limits.js`, `src/chat.js`, `src/routes.js`, `src/main.js`, `src/http/headers.js`, `vercel.json`, `public/app.js`, `db/migrations/031_chat_uploads_bucket.sql` + DB test, `test/uploads.test.js`, `docs/uploads.md`, `.env.example`, `public/legal/privacy.md`, `CLAUDE.md`.
- **Owner steps:** run migration 031 (staging first), set `UPLOADS_DIRECT=true`, redeploy.
- **Validation:** `npm test`, DB tests on Postgres 16, `npm run check:secrets`; headless Chromium: a 5 MB file is signed, PUT and named in the chat request.

## Proposed PR — A bad attachment limit no longer takes the site down (`fix/attachments-limit-soft`)

- **Incident (2026-10-12):** every `/v1/*` call returned 503 `not_configured`; `/v1/status` named `ATTACHMENTS_MAX_MB` (allowed 1–3; Vercel's 4.5 MB body limit) as the setting at fault.
- **Change:** `ATTACHMENTS_MAX_MB` and `ATTACHMENTS_MAX_COUNT` out of range now fall back to their defaults (3 MB, 4 files) with a start-up warning, like other optional settings. The bad value is never echoed.
- **Owner step:** in Vercel, set `ATTACHMENTS_MAX_MB` to 3 (or delete it), then redeploy.
- **Files:** `src/config.js`, `test/config-soft-limits.test.js`.
- **Validation:** `npm test`, `npm run check:secrets`.

## Proposed PR — Sign in always available when signed out (`fix/signin-always-visible`)

- **Owner report (2026-10-12):** the Sign in button was missing. The header button hid whenever `/v1/status` had not said which sign-in methods exist, so a slow or failing status check (the 503 outage) left guests with no way to sign in, and a signed-in person's session was not restored (no Log out).
- **Change:** Sign in (header and Settings) hides only when the server has said sign-in is off; until then it shows, and the sheet explains if sign-in is unavailable. The session is restored unless sign-in is explicitly off, so Log out stays in Settings whenever signed in.
- **Files:** `public/app.js`, `test/ios-header-icons.test.js`.
- **Validation:** `npm test`, `npm run check:secrets`; headless Chromium at 390/1280 with `/v1/status` normal and returning 503.

## Proposed PR — Themes: Orange, Charcoal, Galaxy (`feature/themes`)

- **Owner request (2026-10-12):** besides Appearance, add themes: orange, charcoal, galaxy.
- **Change:** Settings gets a Theme picker (Mono, Orange, Charcoal, Galaxy) under Appearance. Each theme has Light and Dark colours and an accent for the main actions. Mono (the default) is unchanged: every accent rule is scoped to `:root[data-palette]`. Files: `public/index.html`, `public/theme.js`, `public/app.js`, `public/app.css`, `docs/themes.md`.
- **Data:** the theme is kept on the device like the appearance; nothing is sent. `public/legal/privacy.md` lists it among device choices; privacy version 2026-10-12a (`LEGAL_PRIVACY_VERSION` default). The file said 2026-10-08a while the app reported 2026-10-07a; both now say 2026-10-12a. No Terms change, so no one has to accept again.
- **Validation:** `test/themes.test.js` (fails on `main`, passes here); updated legal/status tests for the new privacy version; local `npm test` and `npm run check:secrets`; headless Chromium, every theme in Light and Dark.

## Proposed PR — Menu drawer on phones and tablets; bottom tab bar as an option (`feature/mobile-nav`)

- **Owner request (2026-10-12):** top bar with a menu button that shows the content; the bottom bar becomes an option.
- **Change:** `public/index.html`, `public/app.js`, `public/app.css`, `public/theme.js`; docs `docs/mobile-nav.md`. The bar is the reverted #232 code, now behind Settings > General > Layout (off by default).
- **Data:** a device-only layout choice (`nasrin.tabbar`), like appearance; nothing sent.
- **Validation:** `test/mobile-nav.test.js`; `npm test`, `npm run check:secrets`; headless Chromium at 320/390/768/1280.

## Draft PR #246 — Expose safe startup stage in 503 responses (`fix/startup-503-stage-response`)

- **Problem:** production `/v1/status` returns HTTP 503 quickly and Vercel function logs are unavailable, so the operator cannot tell whether startup fails while loading configuration or constructing the app.
- **Change:** add only a fixed `stage` label (`configuration` or `application`) to the existing 503 JSON response. Keep the incident ID and header. Never return exception text, stack traces, environment values, credentials, or provider payloads.
- **Regression coverage:** `test/startup-diagnostics.test.js` asserts both stage labels and verifies internal exception details remain absent from client responses.
- **Scope:** diagnostic-only; no auth logic, limits, environment values, security checks, or deployment settings change. This narrows the failure location but does not itself repair the underlying exception.
- **Validation:** CI is required before merge. After a separately authorized deployment, inspect `/v1/status` response `error.stage` to direct the next code investigation.

## Proposed PR — Remove the Sign in button above the message box (`fix/remove-guest-signin`)

- **Owner request (2026-10-12):** no Sign in button above the message box (#233 was merged before it could be closed). Sign in stays in the header on every screen; below 400 px the wordmark gives way so it fits. The iOS header icons from #233 stay.
- **Files:** `public/index.html`, `public/app.js`, `public/app.css`, tests, `docs/redesign.md`.
- **Validation:** `test/ios-header-icons.test.js`, `test/ios-header-fit.test.js`; `npm test`; headless Chromium at 320/390/1280.

## Proposed PR — Name the setting at fault in startup 503 replies (`fix/startup-config-hint`)

- **Problem:** since 2026-10-12 ~12:15 (Manila) every `/v1/*` call on production and previews returns 503 "not set up correctly". The server is up but `loadConfig` rejects a Vercel setting; Vercel logs are not available to the owner, so the bad setting cannot be identified.
- **Change:** the 503 JSON now carries `stage` (`configuration` or `application`) and, for configuration failures only, `settings`: the setting names in the error (capitals-and-underscores words such as `CRON_SECRET`). Never the message text, values or stacks. Supersedes draft #246.
- **Use:** open `https://nasrinai.com/v1/status` and read `error.settings`.
- **Validation:** `test/startup-diagnostics.test.js` (names returned; key-like values and message text not); `npm test`, `npm run check:secrets`.

## Proposed PR — Voice typing button: clear Stop while listening (`fix/dictation-button`)

- **Owner request (2026-10-12):** fix the speech-to-text button and make it responsive.
- **Bug:** while dictating, every recognised word switched the button to the Send arrow named "Send message", but a tap only stopped listening and sent nothing; after stopping, the name stayed "Dictate message" next to the arrow.
- **Change:** `public/app.js` names and draws the button in one place (`refreshSendButton`): Stop ("Stop listening") while listening, then Send or the mic. `public/app.css` shows the Stop square while listening. Docs: `docs/chat.md` ("Voice typing").
- **Validation:** `test/dictation-button.test.js` (fails on `main`, passes here); local `npm test` and `npm run check:secrets`; headless Chromium with a fake recogniser: mic → Stop (also after words arrive) → Send → sent, mic again. No server, data or legal change.

## Proposed PR — Minimal voice screen: liquid orb, conversation on top (`ui/voice-screen`)

- **Owner request (2026-10-12):** remove the speed button; a glowing liquid SVG orb in the lower centre that ripples out sound waves; Plus and tier on the left, mute and Exit on the right; the conversation at the top, fading out; minimalist.
- **Files:** `public/index.html` (voice screen markup, class `voice-screen`), `public/voice-liquid-glass.css` (rewritten; all voice-screen styles), `public/app.css` (old voice-screen rules removed), `public/voice-wave.js` (`createOrb`; shared microphone `meter()`; the dictation wave is unchanged), `public/app.js` (speed control and second close button removed; the orb stops talking; realtime transcript fix), `docs/voice-screen.md`.
- **Bugs fixed:** realtime replies split into one line per word (`.voice-line` selector matched nothing); Settings > Voice showed one voice only (the screen's `.voice` CSS also hit the rows); "Realtime voice is on" showed even in compatibility mode.
- **Data:** none collected or kept differently; the per-device speech speed key is cleared (the server's rate is used).
- **Validation:** `test/voice-screen.test.js` (fails on `main`, passes here); local `npm test` and `npm run check:secrets`; headless Chromium at 320/390/1280, light and dark, with a fake microphone: open, tier and Plus menus, outside tap, mute, Exit.

## Proposed PR — Composer controls appear at once (`fix/composer-instant-controls`)

- **Owner request (2026-10-12):** the composer buttons must show with the composer, with no loading or delay and no wait for the models.
- **Before:** the buttons already showed at once on `main` (#235, #239), but the tier bars filled in and the "Automatic" face icon popped in only after `/v1/models` and `/v1/professionals` answered.
- **Change:** `public/index.html` carries the face icon and a filled first bar; `public/app.js` shows the saved tier's bars before any request. The server data still updates them when it arrives.
- **Validation:** `test/composer-instant-controls.test.js`; local `npm test` and `npm run check:secrets`; headless Chromium with the model, professional and status requests held for 4 s: the face and the saved tier (1 bar by default, 3 for a saved Max) show at 0.8 s. No server, data or legal change.

## Proposed PR — Fix the broken downloads script (`fix/files-js-syntax`)

- **Problem:** on `main`, `public/files.js` did not parse ("Unexpected token ';'"): the last entry of the Excel workbook file list (`xl/styles.xml`) was missing its closing `]` since the multi-sheet Excel builder was reapplied. The browser therefore skipped the whole file, so the downloads it builds (Excel, Word, PDF and other files) could not run. #244 fixed the over-escaped regexes in the same function, but this bracket was still missing.
- **Change:** adds the missing `]` (one character). No behaviour change beyond the file loading again.
- **Regression test:** `test/public-scripts-parse.test.js` compiles every `public/**/*.js` browser script; it fails on `main` (files.js) and passes with the fix. The existing #242 tests only checked single regex lines, which is why CI stayed green.
- **Validation:** local `npm test` and `npm run check:secrets`; headless Chromium loads the app with no page errors. No server, data or legal change.

## Proposed PR — Diagnose server startup 503s (`fix/startup-503-diagnostics`)

- **Problem:** production API routes return HTTP 503 when configuration loading or application initialization fails, but the client-facing message is generic and Vercel logs may be unavailable to the operator.
- **Change:** assign a unique startup incident ID, include the ID in a safe JSON error and `X-NasrinAI-Incident-ID` response header, and log the ID with the startup stage. Internal exception details remain server-side; no secrets, stack traces, environment values, or configuration details are returned to clients.
- **Regression coverage:** tests verify both configuration and application startup failures, including that internal exception text is not exposed in the response.
- **Scope:** diagnostic-only; does not change authentication behavior, rate limits, environment values, security checks, or deployment configuration.
- **Validation:** tests must run in CI before merge. This change identifies the startup failure but does not itself claim to repair the underlying initialization exception.

## Fix PR #242 — Excel workbook export regexes (`fix/pr242-xlsx-regex`)

- **Root cause:** the multi-sheet marker and numeric-cell regexes in `public/files.js` were over-escaped, so `[[sheet name="..."]]` blocks were not recognized and numeric values were emitted as text. Worksheet-name sanitization also needed to safely escape the slash delimiter.
- **Fix:** restore the intended JavaScript regular expressions; preserve formula allow-listing and existing workbook limits.
- **Regression coverage:** added tests that exercise the same marker and numeric regexes used by the production builder against valid sheet blocks, numeric values, leading-zero identifiers, and non-matching input.
- **Validation:** automated test execution and real Excel/LibreOffice open checks must pass before merge. This patch does not change authentication, rate limits, or deployment settings.

## Proposed PR — Multi-sheet Excel workbook export (fix/excel-workbook-pr-conflict)

- **Intent:** create a real downloadable `.xlsx` workbook with multiple named tabs.
- **Change (`public/files.js`):** parse up to 8 named worksheet blocks; emit separate worksheet XML; preserve safe formula allow-listing; add frozen header rows, column widths, and autofilters.
- **Prompt and docs:** document the multi-sheet syntax and prohibit claims that native pivot/chart objects exist unless they were actually created.
- **Known gaps:** this does not provide direct 20 MB uploads, in-place editing of uploaded workbooks, or native Excel pivot tables/charts. Base64-in-JSON uploads remain subject to Vercel's function body-size limit.
- **Validation:** automated tests and Excel/LibreOffice workbook-open checks remain pending.

## Proposed PR — Extract Excel workbooks inside ZIP attachments

- **Problem:** an ordinary ZIP archive lists nested files and reads small UTF-8 text files, but does not inspect an embedded `.xlsx`/`.xlsm` workbook. This caused `b2b_invoices.zip` to be reported as a listing rather than readable invoice rows.
- **Change (`src/attachments.js`):** inspect nested workbook entries through the existing bounded ZIP reader and include their extracted worksheet text in the archive context. Do not execute archive contents; retain ZIP entry and decompression limits.
- **Tests (`test/attachments.test.js`):** add a nested workbook fixture and assert worksheet headers and values are extracted.
- **Documentation:** clarify the difference between extraction for analysis and workbook editing/generation; 20 MB upload support is not claimed until the Vercel request-body transport is changed.
- **Validation:** source/test additions only; CI has not been run in this PR.

## Proposed PR — Render composer tier and Automatic controls together (`ui/composer-controls-initial-render`)

- **Problem:** `#modelRow` and `#proBtn` start hidden and appear only after their independent backend catalog calls resolve, causing controls to pop in late or separately.
- **Change:** render both controls in initial HTML with Quick/Automatic fallback labels; keep them visible when catalogs load or fail, and hydrate labels/options when responses arrive.
- **Security:** the server remains authoritative for model-tier access and professional availability; showing controls does not grant access.
- **Docs:** `docs/chat.md` documents the initial-render contract.
- **Validation:** source inspection only; automated tests and browser refresh checks remain pending.

## Proposed PR — Fix greeting shortcut initialization order

- **Bug:** the instant-greeting condition referenced `extra.length` before `extra` was declared, causing a `ReferenceError` for eligible greetings.
- **Fix (`src/chat.js`):** move the shortcut after the extra context array is initialized and appended to history. This preserves the no-provider shortcut while avoiding use-before-initialization.
- **Documentation:** `docs/chat.md` records the required ordering and regression coverage.
- **Validation:** static source check only; automated tests have not yet been run.

## Proposed PR — Return simple greetings without a provider call

- **Problem:** a plain `hi` could proceed through smart routing and wait on the configured model despite needing no reasoning.
- **Change (`src/chat.js`):** return a deterministic short greeting for eligible platform-chat small talk after request validation, existing limits, persistence, history, and policy checks. Record the response as a local logic/rules result with zero model cost.
- **Guardrails:** attachments, voice, professional selection, projects, personal context, knowledge-only tenants, edits, and regenerations retain the normal path.
- **Documentation:** `docs/chat.md` records the shortcut and exclusions.
- **Validation:** source review only; automated tests and production latency measurements remain pending.

## Proposed PR — Read-aloud play/stop icon has no background (`ui/read-aloud-no-background`)

- **Intent:** the owner requests one icon button for read-aloud Play/Stop, with no background.
- **Change (`public/app.css`):** remove the playing-state surface fill and keep the read-aloud icon background transparent in idle, hover, pressed, and playing states. The same button continues to toggle Play/Stop; no separate Stop button is added.
- **Documentation:** `docs/chat.md` records the expected interaction and accessible labeling.
- **Validation:** source-level change only; automated tests and browser checks have not been run for this PR.

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

## Proposed PR — iOS header icons; guest Sign in above the message box (`ui/ios-header-icons`)

- **Intent:** owner request (2026-10-12), with iOS-like header icons, and a guest's Sign in moved from the header to just above the message box in the mobile view (under 70rem). Desktop keeps Sign in in the header.
- **Files:** `public/index.html` (gear, clock and compose icons in the header and desktop rail; `#guestSignIn` in the dock), `public/app.js` (`guestSignIn` and `headerSignIn`, hidden when signed in or sign-in is off; `body.is-typing` while the message box has focus), `public/app.css` (capsule styles, 44 pt on touch, hidden while typing on touch screens, mobile-only; header Sign in desktop-only; the "wordmark yields to Sign in" rule removed), `docs/redesign.md`.
- **Tab bar:** #232 was reverted on `main`; this PR keeps that revert and adds no tab bar.
- **Validation:** `test/ios-header-icons.test.js`, updated `test/ios-header-fit.test.js`; local `npm test` and `npm run check:secrets`; headless Chromium at 320/390/768 (touch) and 1280, light and dark. No server, data or legal change.

## Proposed PR — Redesign R1: design tokens, adaptive background, press and focus states (`ui/redesign-foundation`)

- **Intent:** first phase of the owner's 2026-10-12 redesign (iOS tab bar, refined monochrome look). Adds `docs/redesign.md`: the owner's choices, the design system and phases R1–R5.
- **Change (`public/app.css`):**
  - Design tokens on `:root`: spacing, 44 px `--tap`, radii, type, icon sizes, motion, elevation, press colour.
  - An adaptive background: a soft top light over `--paper`, defined for light, system-dark and the Dark setting.
  - One focus ring and one pressed state for every control.
  - Reduce motion turns the press scale off.
  No markup, script or data change.
- **Check (headless Chromium, local fake-provider run):** home and Settings at 390 px light and dark and 1280 px dark render with no script errors.
- **Regression test:** `test/redesign-foundation.test.js` (fails without the change).

## Proposed PR — Desktop: Enter sends, Shift+Enter new line (`fix/desktop-enter-to-send`)

- **Intent:** owner request (2026-10-12): on desktop, Enter sends and Shift+Enter starts a new line.
- **Change:** `public/app.js` adds a keydown handler on the message box. It sends only on desktop (`(hover: hover) and (pointer: fine)`), never with Shift, Alt, Ctrl or Meta, never while an input method is composing, and never while a reply is being written. Touch devices keep the 2026-10-07 rule (Enter = new line, the Send button sends).
- **Check (headless Chromium, local fake-provider run):** desktop: Shift+Enter adds a line, Enter sends, and Enter during a streaming reply keeps the text and doesn't stop the reply. Phone (390 px touch): Enter adds a line and doesn't send.
- **Regression test:** `test/desktop-enter.test.js` (fails without the change).
- **Docs:** `docs/chat.md`.

## Proposed PR — One play/stop button for reading a reply aloud (`ui/play-stop-audio`)

- **Intent:** backlog item 6 of the 2026-10-12 upgrade: replace the reply's "Listen" pill (Listen / Loading / Pause / Resume, plus a separate Stop button) with a simple play/stop button.
- **Change:** `public/app.js`: the button is a round `act listen` icon button. `setPlaying()` has two states, play ("Play reply aloud") and stop ("Stop reading aloud"); tapping while loading or reading stops. The extra Stop button is gone. `public/app.css`: icon-button styles. Auto read-aloud still clicks the same `.listen` button.
- **Check (headless Chromium, 390 px touch, stand-in device voice):** play → stop label and pressed state; tap → back to play; playing to the end → back to play; no extra Stop button; no script errors.
- **Regression test:** `test/play-stop-audio.test.js` (fails without the change).
- **Docs:** `docs/chat.md` (Read aloud).

## Proposed PR — Reply formatting: safe tables, code always copyable (`feature/reply-formatting`)

- **Intent:** backlog item 3 of the 2026-10-12 upgrade: smarter, more organized, compact replies; code always in a copyable box. It also covers the table and depth gaps from the GPT-capability map in `docs/feature-audit.md`.
- **Change:**
  - `public/format.js` renders Markdown tables with DOM nodes only: a header row, a scroll box with `role="region"` and keyboard focus, capped at 8 × 50, inline formatting in cells. `plain()` flattens tables for Copy and Listen.
  - `src/ai/prompt.js`: code, commands and data always go in fenced blocks with a language; tables only for comparisons; depth follows the person; short paragraphs; Markdown, never HTML. This replaces "No tables, no HTML."
  - `public/app.css`: table styles (cells wrap between words; code in cells stays whole).
- **Check (headless Chromium, local fake-provider run):** a 5-column table scrolls inside its own box at 320 and 390 px and fits at 1280 px. The code block keeps its Copy button.
- **Tests:** `test/reply-format.test.js` (4 tests: tables, caps, code Copy, prompt rules). The table and prompt tests fail on the old code.
- **Docs:** `docs/chat.md`.
- **Validation:** local `npm test` (443 pass) and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.

## Proposed PR — FAQ only when asked (`fix/faq-only-when-asked`)

- **Intent:** backlog item 4 of the 2026-10-12 upgrade: stop adding the FAQ to replies unless the person asks about NasrinAI itself.
- **Root cause:** `src/knowledge/product.js` added the product notes, which tell the model to cite the FAQ, whenever a message contained a common word: plan, function, image, account, support, feature, memory, video and others. Separately, the notes linked the raw `/faq.md`, which the system prompt says never to show.
- **Change:** a new `aboutNasrinAI()` decides when the notes apply (explicit FAQ, Terms, Privacy or refund questions; own-data actions; "your plans", "do you remember", "who made you"; or NasrinAI named with a product topic). The FAQ link is now `[FAQ](https://nasrinai.com/?faq=1)`, and a link is added only where it supports a claim. No prompt-safety, refusal or tenant change: business chats still never get the notes.
- **Tests:** `test/product-knowledge.test.js` adds 8 about-NasrinAI and 8 general messages plus the link check; both new tests fail on the old code. The existing tests are unchanged and pass.
- **Docs:** `docs/knowledge.md`.
- **Validation:** local `npm test` (441 pass) and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.

## Proposed PR — Signed-out Billing offers Sign in (`fix/billing-signed-out`)

- **Intent:** audit finding F3 (`docs/feature-audit.md`, PR #223). Signed out, Settings → Billing called `/v1/billing` (refused with 403, correctly), then showed "Sign in to see billing." as plain text with an empty Payments box.
- **Change:** `public/app.js` `loadBilling()` checks sign-in first. Signed out, it makes no request, shows "Sign in to see your plan and payments" with a **Sign in** button (closes Settings, opens sign-in), and hides the Payments label and box (`#billingPaymentsLabel` in `public/index.html`). The signed-in path is unchanged. One spacing rule in `public/app.css`. No server change.
- **Check (headless Chromium, local fake-provider run, 390 px):** signed out, no `/v1/billing` request and the Sign in button opens sign-in. Signed in, the plan and "No payments yet." show as before (`/v1/billing` 200).
- **Regression test:** `test/billing-signed-out.test.js` (fails without the change).

## Proposed PR — Phone header fits (`ui/ios-header-fit`)

- **Intent:** audit finding F1 (`docs/feature-audit.md`, PR #223). On phones up to 390 px, a signed-out chat made the header 404 px wide (brand, two icons, "New chat", "Sign in"): the page scrolled sideways and Sign in was cut off.
- **Change:** `public/index.html` gives "New chat" an icon and a label span, with `aria-label="New chat"` so its accessible name is unchanged. In `public/app.css`, at ≤ 430 px the label hides and the icon shows. At ≤ 400 px, while Sign in shows (`.bar:has(#headerSignIn:not([hidden]))`), the wordmark gives way; the round mark stays. No script change.
- **Layout check (headless Chromium, local fake-provider run, chat state):** page width equals the viewport at 320, 375, 390, 430 and 768 px (before: 404 at 320–390). Signed in, the wordmark still shows at 390 px.
- **Regression test:** `test/ios-header-fit.test.js` (fails without the change).

## Proposed PR — Feature audit (`fix/feature-audit`)

- **Intent:** backlog item 1 of the 2026-10-12 upgrade: record what works and what doesn't on the user side before fixing anything. Adds `docs/feature-audit.md`.
- **Findings:** F1 header overflows on phones ≤ 390 px in a signed-out chat (page 404 px wide); F2 tap targets under 44 pt; F3 the signed-out Billing page has no way forward. It also maps the owner's GPT-capability list to NasrinAI and sets the iOS design principles and work order.
- **Validation:** documentation only, no code change. Findings come from a local fake-provider run in headless Chromium (every control clicked, signed out and signed in, at 390 and 1280 px; header measured at 320–768 px). Local `npm test` (439 pass) and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.

## Proposed PR — Touch targets at least 44 pt (`ui/ios-touch-targets`)

- **Intent:** audit finding F2 (`docs/feature-audit.md`, PR #223). Header icons, composer buttons, reply actions, the edit pencil, the code Copy button, Listen, Retry, the home buttons and other buttons were 28–42 px: under Apple's 44 × 44 pt minimum.
- **Change:** one `@media (pointer: coarse)` block at the end of `public/app.css` raises them to at least 44 × 44 on touch screens. Reply actions wrap instead of overflowing. Mouse layouts (desktop) keep their compact sizes. No markup or script change.
- **Layout check (headless Chromium, iPhone touch profile, local fake-provider run):** with this PR, no visible control is under 44 pt on the home screen or in a chat at 320 and 390 px (before: 12 on home, 16 in a chat). Combined with PR #224 (header fit), page width equals the viewport at 320 and 390 px. On its own, the page still has the pre-existing header overflow that #224 fixes.
- **Regression test:** `test/ios-touch-targets.test.js` (fails without the change).
- **Validation:** local `npm test` and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.

## Proposed PR — Claude Code handoff (`docs/claude-code-upgrade-handoff`)

- **Intent:** move the 2026-10-12 upgrade into Claude Code sessions. Adds `docs/claude-code-handoff.md` with the owner's rules for the upgrade, what is done (#219, #220, #221), and a 10-item category-branch backlog mapped to the existing code.
- **`CLAUDE.md`:** adds a "Start here" pointer and records the owner's 2026-10-12 branch rule (one pushed branch per category, PR into `main`, owner merges, no failing checks).
- **Validation:** documentation only, with no code, schema or config change. Local `npm test` and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.

## [#220](https://github.com/primusco20/nasrinAI/pull/220) — Center the sign-in security check; smaller on phones (open)

- **Intent:** the Cloudflare Turnstile box was left-aligned under the email form. The owner asked for it lower-center and smaller on phones.
- **Change:** CSS only (`public/app.css`). `.signin-captcha` is a centered flex row. At ≤480 px it uses `transform: scale(0.8)` from the top center and reclaims the scaled space. There are no markup, script, CSP or Turnstile option changes.
- **Layout check (headless Chromium, local fake-provider run):** on a phone at 390 px the widget renders 240×52 centered (x 75–315); on desktop at 1280 px it renders 300×65 centered in the sheet.
- **Regression test:** `test/page.test.js` checks the centering rule, the phone scale rule, and that the widget sits between the email form and the status message. It fails without the CSS change.
- **Validation:** local `npm test` and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.

## [#219](https://github.com/primusco20/nasrinAI/pull/219) — Email sign-in CAPTCHA token field (merged)

- **Intent:** fix "Security check failed" on every email-code sign-in. Supabase Auth logs (2026-10-11, 12:33–13:28 UTC, including after PR #218) show each `/otp` rejected with `captcha protection: request disallowed (no captcha_token found)`. `src/auth/supabase-auth.js` sent the token as a top-level `captcha_token`. Supabase Auth reads it only from `gotrue_meta_security.captcha_token`.
- **Change:** `sendCode` now sends `gotrue_meta_security: { captcha_token }`. There is no change to the Google path (verified server-side via Siteverify), to cookies, tokens, logging, the CSP or the database.
- **Tests:** 3 regression tests in `test/signin.test.js`: the client body shape, route forwarding with Turnstile on (and refusal without a token), and safe mapping of a Supabase CAPTCHA rejection. The first two were confirmed to **fail on the old code** and pass with the fix. Locally `npm test` and `npm run check:secrets` pass. CI and the Vercel preview must pass before merge.
- **Docs:** `docs/security.md`, plus a troubleshooting note in `docs/operations.md`.
- **Follow-up:** after deploy, request one email code and confirm Supabase Auth logs show `/otp` 200. If the error changes to a secret mismatch, re-enter the Turnstile secret in Supabase → Authentication → Bot and Abuse Protection.

## Proposed PR — Media bucket size limit and Supabase security baseline (`security/media-bucket-size-limit`)

- **Intent:** record the 2026-10-12 read-only production audit and commit the one fix already applied there.
- **Migration 029:** sets `file_size_limit = 52428800` (50 MB) on the `media` bucket. It is repeatable, skips cleanly without Supabase Storage, and changes nothing else. It was applied to production on 2026-10-12 via the Supabase connector, where the history lists it as `026_media_bucket_size_limit`. The bucket was empty, and privacy and the MIME list were verified unchanged afterwards. Rollback is in the file header.
- **RLS/grants:** unchanged. The audit found RLS on all 34 tables with deny-all policies for `anon`/`authenticated`, no browser-role grants, and no browser-executable functions.
- **DB test:** `db/tests/029_media_bucket_size_limit.test.sql` checks the limit, privacy, MIME list, other buckets untouched, and repeatability. Locally `db/tests/run.sh` passes on Postgres 16, and the test was confirmed to fail when the migration sets the wrong limit.
- **Docs:** new `docs/supabase-security-baseline.md`; `docs/database.md`.
- **Owner follow-up:** S1, leaked-password protection, is a dashboard setting (Pro plan).

## Proposed PR — Turnstile sign-in protection

- Initial CI surfaced three compatibility failures: the Google PKCE test still expected a GET/302 flow, the strict-CSP test expected `script-src` to contain only `'self'`, and Vercel's CDN CSP did not yet match the server CSP. Updated the test to exercise the new POST/JSON start flow, retained the narrow Turnstile CSP policy in both server and Vercel headers, and aligned the regression assertion. Re-run all CI checks before merge.

| Pending | Add Cloudflare Turnstile to email OTP and Google OAuth initiation | Draft in progress | Adds paired environment configuration, explicit widget rendering, server-side verification for Google OAuth start, Supabase CAPTCHA token forwarding for email OTP, narrow CSP allowances, regression tests, and security/operations documentation. No production settings or deployment changed. CI must pass before merge. |

## Recent PR backfill

| [#210](https://github.com/primusco20/nasrinAI/pull/210) | Explicit server-only RLS deny policies | Open | Adds migration 028 for explicit deny policies and revokes browser-role table grants on server-only tables flagged by Supabase; handles optional feature tables that are absent in a clean migration replay. The first database CI run failed because `portfolio` is a production-only/optional table absent from the clean schema; migration and test now skip absent optional tables while validating all present tables. Recheck CI on the latest commit before merging. Production application remains separate and unconfirmed. |

| [#199](https://github.com/primusco20/nasrinAI/pull/199) | Atomic global spend reservations and daily realtime voice allowances | Open | Sets global estimated-spend defaults to $3 daily / $21 rolling 7 days / $90 rolling 30 days, retaining overall and per-tier request caps. Adds migration 026 for atomic account-scoped daily voice reservations (Quick 5m, Pro 15m, Max 20m, Ultra 30m; Manila midnight reset), conservative per-minute token-quota reservations shared with text, memory/Supabase adapters, fail-closed routing, and regression/database security tests. USD budgets may shorten or refuse voice sessions; exact browser-direct per-turn provider usage remains unavailable. Required CI checks must pass before merge; production Supabase migration/configuration remain unverified. |

| [#196](https://github.com/primusco20/nasrinAI/pull/196) | Harden ZIP central directory and entry bounds | Merged | Rejects inconsistent central-directory metadata, partial scans, unsupported ZIP64 sentinel values, local-header mismatches, and payloads crossing archive boundaries. Adds regression tests and updates `docs/chat.md`. Observed final PR-head checks: GitHub Actions test job passed (including `npm test` and secret scan), database tests passed, and Vercel preview passed. |

| [#198](https://github.com/primusco20/nasrinAI/pull/198) | Add cross-account Memory isolation regression coverage | Merged | Adds a negative test for another account in the same tenant and the same actor ID in a different tenant; updates `docs/security.md`. CI pending; live Supabase isolation remains unverified. No production authorization code changed. |

| [#197](https://github.com/primusco20/nasrinAI/pull/197) | Record merged ZIP checks and security/deployment audit findings | Merged | Corrects PR #196's recorded outcome, clarifies realtime token-accounting and distributed USD-budget limitations, and corrects the Supabase migration checklist. Documentation only; live production configuration remains unverified. GitHub Actions (`npm test`, secret scan, database tests) and Vercel preview passed on the audit revision. |

| [#195](https://github.com/primusco20/nasrinAI/pull/195) | Reject truncated ZIP archives safely | Merged | Rejects buffers shorter than the ZIP end-of-central-directory minimum, adds truncated-header regression coverage, and documents safe handling. |
| [#194](https://github.com/primusco20/nasrinAI/pull/194) | Handle malformed EPUB manifest paths safely | Merged | Skips malformed percent-encoded EPUB manifest paths, adds a regression test, and documents malformed archive handling. CI passed before merge. |
| [#192](https://github.com/primusco20/nasrinAI/pull/192) | Scope coding and file analysis without artifact generation | Merged | Documentation-only scope correction. Existing code/file analysis remains non-executing; no new runner, OCR, artifact-generation, publishing, schema, or RLS behavior was introduced. |

Status reflects the repository state at the latest documentation update.

| PR | Change | Status | Documentation note |
| --- | --- | --- | --- |
| [#191](https://github.com/primusco20/nasrinAI/pull/191) | Show current plan beside Billing in Settings | Merged | Displays the signed-in user's current plan from existing `/v1/plans` data in the Billing navigation row; no new request or billing logic. Regression assertions added. |
| [#190](https://github.com/primusco20/nasrinAI/pull/190) | Separate Usage and Billing settings pages; inline Usage spinner and independent loading | Merged | Adds dedicated Usage/Billing navigation, direct string/page-boundary regression assertions, and documentation workflow. Latest observed CI: test job passed (including npm test and secret scan); database job's test step passed and the job was still finishing cleanup when checked. Vercel passed on the latest commit checked. The test job passed on the previously checked commit; the latest commit's required checks must be rechecked before merging. |
| [#189](https://github.com/primusco20/nasrinAI/pull/189) | Secure coding and file workspace architecture | Open (superseded) | Original scope included artifact generation and isolated execution. Superseded by the analysis-only scope in [the replacement PR](https://github.com/primusco20/nasrinAI/pull/192); artifact generation, OCR, publishing, and code execution are excluded from this plan.
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
- The Billing navigation row displays the signed-in user's current plan (Free, Pro, Max, or Ultra) on the right, before the chevron. It uses the plan returned by the existing `/v1/plans` request, hides the value when no signed-in account or known plan is available, and does not introduce a new request or change billing rules.
- Usage contains usage meters and its inline loading indicator.
- Billing contains the current plan, upgrade/renew action, payment history, and billing disclosures.
- Opening Usage loads usage data; opening Billing loads billing data.
- Periodic usage refresh runs only while the Usage page is visible.

### Scope

The UI change is limited to `public/index.html`, `public/app.js`, and `public/app.css`, with focused regression coverage at `test/settings-usage-billing-separation.test.js`. The current-plan label is populated from the existing signed-in plan data. No backend endpoint, billing rule, schema, or RLS policy is intended to change.

### Validation

The original test used over-escaped regular expressions. The test is being simplified to explicit string and page-boundary assertions to avoid fragile regex escaping. Verify the repository's test command and all required CI checks after the correction; do not treat the fix as verified until those checks return results.


## Voice-model catalog visibility audit

- Keep OpenAI and Gemini voice choices in Settings whenever the server knows the catalog, even if a provider is not configured; unavailable choices must be visibly disabled and must not trigger provider requests.
- Do not gate provider-catalog rendering on browser `AudioContext` support. Browser audio support affects playback, not whether configuration choices can be displayed.
- The public `/v1/status` response returns the known voice catalog and a separate availability flag. It exposes no provider credentials or secret configuration.
- Regression tests cover the rendering gate and status response shape. Verify all CI checks before merge; no production settings or secrets are changed by this UI fix.


### CI correction — voice catalog status contract

- The first CI run exposed one outdated assertion in the existing /v1/status test: it expected an empty voice catalog and default null, although the intended fix now publishes known voice IDs and the coral default while correctly marking provider voices unavailable.
- Updated that test to normalize only the voice-catalog fields before checking the unrelated status contract. Dedicated regression tests continue to check catalog visibility and response structure.
- Re-run the full test suite and required CI checks before merge; this is a test expectation correction, not a rollback of the voice catalog behavior.


## Turnstile sign-in initialization regression

- Cache the public Turnstile site key when the app's initial `/v1/status` request completes.
- Keep Turnstile widget rendering deferred until the sign-in sheet opens, so the widget is initialized inside its visible container.
- Allow `loadAuthMethods()` to finish Turnstile setup even when sign-in methods were already cached by the initial status request. This prevents Google/email sign-in from submitting without the required CAPTCHA token.
- No secrets, server-side verification rules, OAuth redirect URLs, database schema, or unrelated UI behavior are changed.
- Validate with the focused regression checks and full CI before merge; production behavior is not considered fixed until a deployment is tested.


## Google CAPTCHA failure diagnostics

- Add server-side warning categories for the Google OAuth start route when the CAPTCHA token is missing/invalid or Cloudflare verification fails.
- Logs contain only a fixed reason category; CAPTCHA tokens, Turnstile secrets, and provider response payloads are never logged.
- This is diagnostic instrumentation only. It does not bypass CAPTCHA verification or change DNS, OAuth redirects, production secrets, or database state.
- Validation required: run the focused auth tests and full CI, then test the deployed sign-in flow and inspect the corresponding Vercel function logs before treating the issue as resolved.


## Sign-in CAPTCHA placement

- Move the existing Turnstile widget container from between Google sign-in and the email form to immediately below the email sign-in form, so the verification UI sits beneath the email action on mobile.
- Keep the same widget element and ID; client initialization, callbacks, token submission, and server-side verification remain unchanged.
- No DNS, authentication configuration, or unrelated layout changes.
- Validate with CI and test both Google and email sign-in on a narrow mobile viewport before considering the change complete.


## Google OAuth callback failure diagnostics

- Log a fixed reason category when the Google callback has no authorization code, no PKCE verifier cookie, or an invalid-length authorization code.
- Never log the authorization code, PKCE verifier, cookies, or provider secrets.
- This makes the existing callback early-return path observable without changing OAuth validation, cookie policy, CAPTCHA verification, or redirect behavior.
- Validate with focused auth tests and full CI before merge; then inspect the production callback log to select any further fix based on evidence.


## Email sign-in CAPTCHA/upstream error handling

- Preserve a constrained upstream status and error-code category for email OTP rejection so production logs can distinguish a CAPTCHA rejection from other email-send failures.
- Map upstream errors explicitly mentioning CAPTCHA/Turnstile to a safe security-check message rather than the generic email-delivery message.
- Logs never include the email address, CAPTCHA token, CAPTCHA secret, raw upstream response, or provider message text.
- This does not bypass CAPTCHA or change production configuration. Validate with focused auth tests and full CI before merge; if Supabase rejects the token, verify its CAPTCHA provider configuration against the Cloudflare Turnstile secret.

## Proposed PR — AI Automation policy foundation

- Define owner-scoped workflows for Gmail/Google Workspace first and future official integrations for Facebook, Instagram, LinkedIn, X, and TikTok.
- Add a bounded workflow validator and a fail-closed action decision policy. Sending email, publishing posts, replying to comments, and creating calendar events require approval unless the owner explicitly enables automation and allow-lists that exact action.
- Add migration 030 for private workflow and run records; direct anon/authenticated table access is revoked. The migration is proposed and has not been run against Supabase.
- Add regression tests for provider/action compatibility, approval defaults, explicit auto-allowlists, disabled workflows, and missing provider authorization.
- Important scope limit: this PR is the policy/schema foundation only. It does not yet wire OAuth callbacks, encrypted user OAuth tokens, provider API calls, queue/scheduler, UI, or live sending/publishing. Social providers remain planned until each official API/app review is configured and tested.
- Validate with npm test, secret scanning, SQL review, and focused OAuth/ownership tests before merge. Do not deploy or apply migration without explicit authorization.



## Proposed PR — Semantic cache write fallback and stable scope

- Preserve a successfully computed embedding when the semantic-cache search RPC fails, so the normal AI reply can still seed the cache; embedding failures continue to fall back safely without blocking chat.
- Log a safe failure stage (`search` or `embedding`) without logging prompts, embeddings, keys, or raw upstream/database error details.
- Remove per-conversation history hashing from the semantic scope. Existing policy eligibility already restricts this path to first-turn, attachment-free, non-sensitive requests; the stable actor/tier/task scope allows eligible repeats across separate conversations without sharing cache entries between actors.
- Add regression coverage for retaining embeddings on search-RPC errors and for the stable scope behavior.
- No SQL, RLS, auth, token limits, or unrelated UI changes. Require focused tests, full CI, and production verification before considering the fix complete.


## Proposed PR — Await semantic cache writes safely

- Await the persistent semantic-cache insert attempt before returning a successful chat response, preventing serverless execution from ending while the write is still pending.
- Keep cache writes best-effort: a rejected insert is caught, logged with a fixed safe message, and does not turn a successful AI answer into a chat failure.
- Add chat integration regression tests for both delayed writes (response remains pending until the write attempt settles) and failed inserts (chat still returns HTTP 200 without exposing database error details).
- No SQL, RLS, authentication, token-limit, provider-routing, or unrelated UI changes.


## Proposed PR — Universal slash commands execute first (`feature/universal-slash-execute-first`)

- **Owner request (2026-10-12):** add universal shortcuts such as `/clone` and `/blur` across NasrinAI, and avoid unnecessary follow-up questions.
- **Change:** add a dependency-free browser command registry for image, video and common chat tasks; dispatch image/video shortcuts to existing media endpoints; execute image shortcuts directly without optional brief questions or the extra confirmation sheet; add execute-first instructions to the chat system prompt. Commands needing a reference image require an attachment. Server-side authorization, plan, budget, legal and safety checks remain unchanged.
- **Documentation:** `docs/features/universal-slash-commands.md`, `docs/chat.md`, `README.md`.
- **Validation observed (commit `0c53e78`):** `npm test` passed 517/517; `npm run check:secrets` reported no secrets in 425 files; database tests passed; GitGuardian Security Checks passed; Vercel Preview reported Ready. Re-run checks on the final documentation commit before merge.


## Security hardening — automated dependency audit

- Add a CI dependency-audit job that resolves npm dependency metadata with lifecycle scripts disabled and fails on high-severity or critical npm advisories.
- Keep the existing test, secret-scanning, and database jobs intact.
- Document the current missing committed lockfile and the mismatch between `package.json` and ADR-002; reconcile those separately based on actual import and hosting requirements.
- No application runtime, authentication, token limits, database schema/RLS, production secrets, or deployment configuration changes.
- Validation required: review the dependency-audit job and all required CI results on this PR before merge. The temporary-lockfile audit is not a substitute for a committed lockfile and reproducible dependency installation.


## Proposed PR — Scan test files for committed secrets (`security/scan-test-fixtures`)

- **Change:** remove the blanket `test/` exclusion from `scripts/check-secrets.js`; split synthetic key examples in tests into fragments; extend the scanner regression to require detection in both source and test paths.
- **Validation:** pending CI on the PR; do not merge until `npm test`, `npm run check:secrets`, and required repository checks pass.


## Proposed PR — Bound GitHub coding archive expansion (`security/harden-runner-archive-limits`)

- **Change:** validate repository gzip/tar archives before sandbox extraction; cap compressed/expanded sizes, entry count, and individual entry sizes; reject unsafe traversal paths and links/special file types; reconcile the secure-workspace document with the implemented GitHub runner.
- **Validation:** pending CI. The real Vercel Sandbox integration test remains opt-in and must not be reported as passed when skipped.


## Proposed PR — Browser render, test, screenshots and recordings (`feature/browser-render-test-screenshots-ci`)

- **Owner request (2026-10-13):** NasrinAI renders and tests code, and sends screenshots and videos to the person, like Claude does.
- **Change:** `github_render_test_screenshot` (`src/github/browser-runner.js`): app sandbox (npm registry only during install, then no network) runs the test and preview; a browser sandbox booted from a prepared snapshot (`AGENT_BROWSER_SNAPSHOT_ID`, `scripts/create-browser-snapshot.mjs`) reaches only the preview, records a short WebM and takes a JPEG; both saved for the person in that chat and shown above the reply (`[image:id]`, `[video:id]`, `GET /v1/recordings/:id`). Registry: tools marked `media: true` may attach media; the chat id comes from the server. Tool time 90 s (registry limit). Privacy Notice 2026-10-13g (no re-acceptance).
- **Fixed from the first version:** the base64 screenshot could never pass the 8 KB tool-result limit; the 240 s time could not run (90 s registry cap, 120 s function); the browser sandbox reinstalled Chrome on every run and had wide network access.
- **Validation:** `npm test`; live sandbox runs need the owner's Vercel account.


## Proposed PR — Dependencies: remove unused, pin, commit lockfile (`security/deps-lockfile`)

- **Change:** remove `express` and `@supabase/supabase-js` (not imported anywhere); pin `@vercel/sandbox` 3.8.0 and `@agent-browser/sandbox` 0.39.1 (loaded on demand by the coding runner only); commit `package-lock.json`; CI fails when the lockfile is out of date; ADR-002 amended; `docs/security.md` follow-up closed.
- **Validation:** `npm test`, `npm run check:secrets`, `npm audit --audit-level=high` (0 vulnerabilities) locally; CI pending. No app runtime code, schema, or production settings changed.

## Proposed PR #361 — Free LLM pool continuity, accounting, and owner visibility (2026-10-15)

- **Owner request:** document the full free-provider pool plan; ensure a provider reaching its quota does not pause all NasrinAI use; record token consumption and costs per model; show separate remaining credits and costs for OpenAI, Gemini, and Claude in the Owner Command Center.
- **Change:** expanded `docs/nasrinai-autonomous-coding-engine-upgrade.md` Section 15 with provider catalogue/security requirements, quota exhaustion classification and cooldown, bounded fallback/reset recovery, logical request vs provider-attempt accounting, token/cost provenance, provider credit source rules, privacy, detailed acceptance criteria, and current implementation status. Updated `docs/free-llm-provider-pool.md` is the provider catalogue/setup reference.
- **Owner dashboard spec:** corresponding detailed UI, metric/source semantics, balance rules, alerts, authorization, acceptance tests, and progress are recorded in Section Q of `docs/owner-command-center.md` on PR #353.
- **Status:** documentation/planning only for the new requirements. Existing provider pool foundations are on this branch; quota-aware reset/failover, live usage/billing APIs, real credit balances, and the live dashboard are not claimed as implemented.
- **Validation:** previously reported CI was 655 tests passed with secret scan, dependency audit, and database tests passing; those results predate this documentation update. New commits require fresh CI. No keys, credits, Vercel settings, production schema, merge, or deployment changed.
- **Next:** implement in reviewed phases, update progress with actual source mappings and test outcomes, and wait for explicit owner approval before merge/deployment.

## Owner Command Center — LLM provider accounting and free-pool continuity (2026-10-15)

- **Owner request:** integrate the legitimate free LLM provider pool; keep NasrinAI available when one free provider reaches its quota by cooling down that provider and failing over to another eligible provider until reset; show model-level token consumption, costs, and remaining credits in the owner dashboard.
- **Specification:** added Section Q to `docs/owner-command-center.md` covering separate OpenAI, Gemini, and Anthropic/Claude accounting; other free-pool providers; input/output/other token categories; logical requests vs provider attempts; actual vs estimated cost; verified source/freshness; separate credit/balance semantics; filters, sorting, trends, exports, alerts, security, acceptance gates, and progress status.
- **Dependency:** provider catalog/adapters and exact free-model allowlists are being tracked in [PR #361](https://github.com/primusco20/nasrinAI/pull/361). Provider quota reset/failover, live billing/usage sources, credit balances, and dashboard runtime remain unimplemented/unverified until code and tests prove them.
- **Validation:** documentation-only. No runtime tests, provider API calls, account credits, secrets, schema changes, production environment changes, merge, or deployment performed by this entry. CI must rerun on new commits.
- **Next:** inspect actual usage writers, spend reservations, provider pricing/billing APIs, and migration definitions; implement server-side accounting and owner-secured endpoints with regression tests. Never fabricate balances or stop the whole eligible pool because one provider quota is exhausted.
