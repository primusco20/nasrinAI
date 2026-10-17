# Claude Code handoff: NasrinAI upgrade (started 2026-10-12)

Read `CLAUDE.md` first, then this file. It carries the owner's upgrade request, the working rules for it, what is already done, and where each item lives in the code. Update the **Status** column in the same PR whenever an item moves.

## 1. Owner's rules for this upgrade

1. **Quality and security before speed.** Never weaken Supabase RLS, policies, grants or storage privacy (baseline: [supabase-security-baseline.md](supabase-security-baseline.md)).
2. **One branch per category**, pushed to GitHub with its own PR into `main`. **Do not merge**: the owner merges.
3. **No PR is handed back with failing or pending checks.** Required checks:
   - `test` (`npm test` + `npm run check:secrets`)
   - `database` (`db/tests/run.sh`)
   - GitGuardian
   - Vercel preview
4. **Everything documented in Markdown** in the same PR: the feature doc, `docs/pr-change-log.md`, and legal docs when data handling changes (CLAUDE.md rule 9).
5. **Every change tested.** Add a regression test that fails without the change, and state only results you actually observed.
6. **Supabase is production.** Read-only inspection is fine. Schema or config changes go in a numbered migration with a DB test and are tried on staging first. Never print or commit keys or user data.
7. Zero runtime dependencies (ADR-002) and the strict CSP (`'self'`, no inline scripts or styles) still apply. Any library idea needs the owner's OK first.

## 2. Done so far

| PR | What | State |
|---|---|---|
| #219 | Email sign-in "Security check failed": the CAPTCHA token was sent top-level; Supabase reads `gotrue_meta_security.captcha_token` | Merged |
| #220 | Cloudflare check centered below the email button, 80% size on phones | Merged |
| #221 | Migration 029 (50 MB `media` bucket limit, already live) + Supabase security baseline | Open, checks green |

Owner action still pending: turn on leaked-password protection (Supabase → Authentication → Providers → Email; Pro plan).

## 3. Upgrade backlog (one branch each)

| # | Branch | Request (owner's words, condensed) | Where to start | Status |
|---|---|---|---|---|
| 1 | `fix/feature-audit` | Scan every feature and fix the ones not working | Run the app (`AI_PROVIDER=fake npm start`). Go through every feature in `CLAUDE.md` → Map. "Not yet tested against live services" lists items that need the owner's keys. Write findings in `docs/feature-audit.md` before fixing anything. | Done (#223) |
| 2 | `feature/messy-file-cleaner` | Upload a messy Excel/CSV; get clean, organized tables and a dashboard with **no data lost** | `src/attachments.js` (`xlsxText`, CSV) only extracts text today. Needs a structured parser (Node built-ins only), header detection, type cleanup, and a check that every source row and cell value is accounted for (row/cell counts and a checksum in the output). Never overwrite the upload. Check `src/library.js` and `src/storage.js` for where results are kept. | PR open |
| 3 | `feature/reply-formatting` | Smarter, more organized, compact replies; code always in a copyable box | Code blocks already get a Copy button (`public/format.js`, `code-copy`); verify it on mobile and in every reply path. Reply style lives in `src/ai/prompt.js`. | Done (#228) |
| 4 | `fix/faq-only-when-asked` | Stop adding the FAQ to replies unless asked | `src/ai/prompt.js` lines that tell the model to cite the FAQ link; product knowledge in `src/knowledge/product.js`. Keep the FAQ when the user asks about NasrinAI itself. | Done (#227) |
| 5 | `feature/web-sources-collapsed` | Web search with sources as links, collapsed beside the Retry button | `src/web/search.js` already returns `url_citation`s. `src/chat.js` currently appends them as a "**Sources**" text block. Send them as structured data in the NDJSON stream and render a collapsible "Sources" control next to Retry in `public/app.js`. Store them with the message. | PR open |
| 6 | `ui/play-stop-audio` | Replace the reply "Listen" button with a simple play/stop button | `public/app.js`: the `listen` button and its labels (Listen / Loading / Pause / Resume). Keep an accessible label. | Done (#229) |
| 7 | `feature/media-recall` | Smarter memory: "show me the image you generated yesterday" shows it, with little text | Chat recall exists in `src/conversations.js` (`isPastIntent`, `recallWindowDays`; tests in `test/memory-recall.test.js`). Images are in `generated_images` (`src/store/supabase-store.js`, `src/images.js`). It must stay tenant- and owner-scoped, the 30-day keep time applies, and no cross-account access is allowed. | Done (generated-picture recall fixes) |
| 8 | `ui/generation-loader` | A tech-style loading animation while an image, video or file is being made | Picture and video flows in `public/app.js` (image cards). It must respect `prefers-reduced-motion`. | PR open |
| 9 | `ui/reply-fade-no-autoscroll` | Replies fade in; the screen stays where the user is reading instead of scrolling down | Streaming render and scroll handling in `public/app.js` (search `scrollHeight`). Only follow the bottom if the user is already at the bottom. | PR open |
| 10 | `ui/responsive-pass` | Fix the UI/UX for desktop, tablet and mobile without changing data | Existing tests: `test/adaptive-*.test.js`. Previous layout PRs are #174–#182 (see change log). Check at 390, 768 and 1280 px. | To do |

Suggested order: 1 → 4 → 3 → 6 → 9 → 8 → 5 → 7 → 2 → 10. Small UI items go first; items that touch data or storage (7, 2) go after the owner reviews the plan.

## 4. For each branch

1. Branch from the latest `main`. State the branch, uncommitted changes, target, plan, and effect on the live site.
2. Change → test (one that fails first) → docs → `npm test` → `npm run check:secrets` → DB tests if SQL changed.
3. Push, open a PR into `main`, wait for all checks, and fix anything red.
4. If `main` moved and the PR conflicts, merge `main` into the branch. Don't rebase or force-push.
5. Report in a few lines: PR link, what changed, and any owner steps.


## 5. New owner-requested work: production quality / anti-vibe-coding

- **Detailed specification:** [docs/nasrinai-production-quality-anti-vibe-coding-upgrade.md](nasrinai-production-quality-anti-vibe-coding-upgrade.md)
- **Master progress index:** [docs/CLAUDE_MASTER_PLAN_SUMMARY.md](CLAUDE_MASTER_PLAN_SUMMARY.md)
- **Status:** Documentation added on branch `docs/production-quality-anti-vibe-coding`. Implementation has not started and no production result is claimed.
- **Owner goal:** Make NasrinAI feel deliberately designed and professionally engineered, not like a generic AI template. Audit and improve brand consistency, public URLs and routing, page-specific SEO, canonical URLs, sitemap.xml, robots.txt, useful 404 responses, SSR/static rendering where suitable, headings, internal links, breadcrumbs, favicon, image alt text, social previews, truthful structured data, console errors, source-map exposure, bundle size, and placeholder copy.
- **Configuration rule:** Do not add hardcoded production defaults. Production configuration and secrets belong in Vercel Environment Variables or an appropriate secure managed configuration system.
- **Execution:** Claude must inspect the actual code and deployment setup first, create a route inventory and performance baseline, implement in small reviewable changes, add regression tests, update documentation, and verify actual production behavior. Do not assume every route should use SSR or that all gradients/source maps are inherently wrong; apply the specification's context-sensitive rules.
- **Acceptance:** Follow Section 13 in the detailed specification. Record tests and observed results, unresolved risks, and deployment evidence. Preserve authentication, RLS, CSP, private data, and owner-only restrictions.
- **Workflow:** Follow the existing rules above: branch/PR workflow, all required checks green, and owner merges. Do not merge or deploy without owner authorization.
