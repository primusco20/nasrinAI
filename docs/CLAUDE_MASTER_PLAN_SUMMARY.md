# Claude Master Plan Summary

**Repository:** `primusco20/nasrinAI`  
**Purpose:** Compact index and progress memory for Claude. Read `CLAUDE.md` and `docs/claude-code-handoff.md` first. Detailed requirements belong in linked specification files.

## Active documentation upgrade

### Production quality and anti-vibe-coding audit

- **Specification:** [NasrinAI Production Quality & Anti-Vibe-Coding Upgrade](nasrinai-production-quality-anti-vibe-coding-upgrade.md)
- **Status:** Added to documentation branch for Claude to audit and implement. No code implementation or production deployment is claimed by this document-only change.
- **Goal:** Make NasrinAI look intentionally designed and professionally engineered; fix routing, SEO, metadata, SSR/static rendering where appropriate, 404 handling, sitemap, robots, accessibility, social previews, structured data, performance, console errors, source-map exposure, and placeholder content.
- **Important constraints:** Audit before changing architecture; preserve existing behavior and security; no hardcoded production config or secret defaults; use Vercel environment variables for deployment configuration; protect private pages and user data; do not expose source maps unnecessarily; no fabricated business data; do not merge/deploy without owner approval.
- **Execution order:** Baseline audit and route inventory → routing/404/canonical domain → SEO metadata and crawl files → brand/assets/schema → SSR/performance → console/content hygiene → automated and production-like verification.
- **Acceptance:** See the linked specification's Section 13. Record evidence, tests, remaining risks, and deployment verification before marking complete.

## Working rules

1. Read `CLAUDE.md` and the current handoff before changing code.
2. Follow `docs/claude-code-handoff.md`: focused branches, PR into `main`, tests and documentation, and no merging by Claude.
3. Quality and security before speed. Preserve Supabase RLS, authentication, authorization, CSP, and owner-only restrictions.
4. Never claim tests, checks, deployment, or production behavior were verified unless the relevant check was actually run.
5. Keep this file updated when the upgrade status or implementation evidence changes.
