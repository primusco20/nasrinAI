# NasrinAI Production Quality & Anti-Vibe-Coding Upgrade

**Status:** Planned specification  
**Purpose:** Make NasrinAI feel and perform like a deliberately engineered, production-grade AI platform rather than a generic AI template.  
**Implementation rule:** Audit the existing repository before changing architecture. Preserve working behavior, authentication, security, accessibility, and product features. Do not claim an item is complete until verified.

## 1. Brand and visual quality

- [ ] Remove generic template patterns that make the product look automatically assembled or “vibe coded.”
- [ ] Use a consistent NasrinAI design system: typography, spacing, borders, elevation, iconography, motion, and component states.
- [ ] Keep the visual direction premium, restrained, and intentional. Use orange as a deliberate accent where appropriate; avoid gratuitous purple gradients and excessive decoration.
- [ ] Use gradients only when they serve a clear design purpose. Do not introduce gradients merely to make the interface look “AI-like.”
- [ ] Ensure pages have deliberate layouts, clear hierarchy, consistent alignment, responsive behavior, and polished empty/loading/error states.
- [ ] Avoid repetitive generic marketing copy, fake metrics, fabricated testimonials, and unsupported claims.
- [ ] Review the interface at mobile, tablet, and desktop sizes, including Safari on iOS.
- [ ] Honor reduced-motion preferences and maintain accessible contrast, focus indicators, keyboard navigation, and semantic controls.

## 2. Domain, URLs, and routing

- [ ] Use `https://nasrinai.com` as the canonical public origin, subject to verifying the live domain and deployment configuration.
- [ ] Ensure every intended public page has a stable, meaningful, directly navigable URL.
- [ ] Make direct navigation and page refresh work for each route; avoid routes that work only after visiting the homepage.
- [ ] Define a consistent trailing-slash and URL normalization policy.
- [ ] Redirect alternate production hostnames and HTTP requests to the canonical HTTPS origin when appropriate.
- [ ] Prevent redirect loops, broken links, duplicate route variants, and accidental exposure of internal routes.
- [ ] Keep authenticated, account-specific, owner-only, and private application routes protected. Do not expose private content to crawlers.
- [ ] Return correct HTTP status codes, including a genuine 404 for missing pages rather than showing a homepage with status 200.
- [ ] Test unknown paths, nested routes, query strings, redirects, refreshes, and direct links.

## 3. Per-page SEO metadata

For every indexable public page:

- [ ] Provide a unique, descriptive HTML `<title>`.
- [ ] Provide a unique, accurate meta description written for that page.
- [ ] Include an absolute canonical URL pointing to the preferred version of that page.
- [ ] Set the correct document language and viewport metadata.
- [ ] Use one clear, descriptive primary `<h1>` and a logical heading hierarchy.
- [ ] Ensure title, H1, visible content, and metadata describe the same subject.
- [ ] Add relevant internal links using descriptive anchor text.
- [ ] Use breadcrumbs on suitable nested pages, with accessible markup and matching breadcrumb structured data when appropriate.
- [ ] Do not add `noindex` to pages intended for search indexing; do not index private, account, admin, or duplicate pages.
- [ ] Avoid keyword stuffing, duplicated metadata, empty titles, and generic descriptions repeated across the site.

## 4. Crawling and indexation files

- [ ] Generate and maintain a valid `/sitemap.xml` containing only canonical, indexable URLs.
- [ ] Update the sitemap when public routes change. Use accurate last-modified values only when they reflect meaningful changes.
- [ ] Provide a valid `/robots.txt` at the production root and include the sitemap URL.
- [ ] Do not treat `robots.txt` as access control. Sensitive routes must be protected by authentication and authorization.
- [ ] Ensure blocked resources do not prevent search engines from rendering important public page content.
- [ ] Validate sitemap and robots files against the deployed site.

## 5. Server-side rendering and delivery

- [ ] Audit the current framework and deployment model before choosing SSR, static generation, or hybrid rendering.
- [ ] Use SSR or static generation for public pages where it improves initial content delivery, crawlability, and performance.
- [ ] Preserve client-side interactivity for features that require it.
- [ ] Keep authentication state, user data, and private content out of shared public caches.
- [ ] Ensure metadata and meaningful page content are present in initial HTML for public pages where supported by the chosen approach.
- [ ] Avoid hydration errors, server/client markup mismatches, duplicate data fetching, and unnecessary client-only rendering.
- [ ] Verify compatibility with the existing Vercel deployment and runtime before changing framework configuration.

## 6. 404 and error handling

- [ ] Build a branded, useful 404 page with a clear message and relevant recovery links.
- [ ] Ensure missing routes return HTTP 404, not HTTP 200.
- [ ] Do not automatically redirect every unknown URL to the homepage.
- [ ] Provide understandable error, loading, empty, and retry states for relevant flows.
- [ ] Never show stack traces, internal paths, secrets, tokens, raw provider errors, or sensitive user data to end users.
- [ ] Log actionable diagnostic details server-side with appropriate redaction.

## 7. Favicon, images, and social sharing

- [ ] Provide the correct NasrinAI favicon and appropriate platform icon assets where needed.
- [ ] Verify icon paths, formats, sizes, caching, and browser/mobile display.
- [ ] Add descriptive alt text to informative images. Use empty alt text for purely decorative images; do not stuff keywords into alt text.
- [ ] Optimize image dimensions and formats, and lazy-load below-the-fold images where appropriate.
- [ ] Do not lazy-load critical above-the-fold or likely Largest Contentful Paint images without a good reason.
- [ ] Provide suitable Open Graph and social-sharing metadata, including page-specific share titles, descriptions, and images when useful.
- [ ] Use absolute, publicly accessible share-image URLs and verify previews.
- [ ] Do not expose private uploads or user content through public share metadata.

## 8. Structured data

- [ ] Add valid `Organization` or other appropriate business structured data only when supported by real, verified information.
- [ ] Keep structured data consistent with visible page content.
- [ ] Add `BreadcrumbList` where the page actually has a breadcrumb trail.
- [ ] Use `WebSite`, `SoftwareApplication`, or other schema types only when appropriate and factually accurate.
- [ ] Never fabricate review counts, star ratings, prices, addresses, awards, opening hours, or other details.
- [ ] Validate structured data and remove obsolete or contradictory schema.

## 9. Performance and JavaScript bundles

- [ ] Measure the current baseline before optimizing.
- [ ] Inspect bundle and route-level reports to identify large dependencies and duplicated code.
- [ ] Split code by route and lazy-load noncritical features when this improves real user performance.
- [ ] Remove unused dependencies and dead code only after checking their usage and impact.
- [ ] Reduce unnecessary re-renders, repeated requests, and expensive computations.
- [ ] Compress and correctly size assets; use browser/CDN caching where safe.
- [ ] Cache public data carefully, with explicit invalidation and no cross-user leakage.
- [ ] Paginate or virtualize large collections where appropriate.
- [ ] Optimize database queries and indexes only after reviewing query patterns and measuring impact.
- [ ] Avoid loading analytics, widgets, and third-party scripts before needed.
- [ ] Track Core Web Vitals and run Lighthouse or equivalent production-like checks.
- [ ] Define bundle budgets from measured baselines rather than arbitrary guesses.

## 10. Console, logging, source maps, and production hygiene

- [ ] Fix uncaught exceptions, failed network requests, hydration warnings, missing assets, framework warnings, and actionable console errors.
- [ ] Remove temporary debugging output and accidental verbose logging from production paths.
- [ ] Keep error reporting useful without logging credentials, access tokens, sensitive personal information, or private prompts.
- [ ] Decide source-map policy deliberately. Do not expose production source maps publicly when they could disclose proprietary implementation details.
- [ ] If source maps are needed for error monitoring, upload them privately to the monitoring provider and restrict public access as appropriate.
- [ ] Confirm production builds do not depend on development-only tools or debug configuration.
- [ ] Test for broken links, missing assets, failed API calls, and unhandled errors after deployment.

## 11. Copy and content integrity

- [ ] Remove unintended Lorem ipsum, placeholder copy, template leftovers, fake names, dead buttons, and unfinished labels.
- [ ] Replace placeholders with accurate product copy, or clearly mark incomplete content internally until ready.
- [ ] Keep language specific, concise, and consistent with NasrinAI's actual capabilities.
- [ ] Avoid repetitive, formulaic AI marketing language and excessive em-dash usage in product copy.
- [ ] Do not perform blind punctuation replacement across source code, URLs, legal text, or content where punctuation has semantic meaning.
- [ ] Verify claims, feature descriptions, plan names, prices, limits, and links against actual product configuration.

## 12. Configuration and security constraints

- [ ] Do not introduce hardcoded production configuration, secret keys, provider credentials, plan limits, or environment-specific origins as fallback defaults.
- [ ] Store environment-specific values and secrets in Vercel Environment Variables or the appropriate secure managed configuration system.
- [ ] Validate required configuration at startup or deployment time and fail clearly and safely when required values are absent.
- [ ] Keep secrets server-side. Never expose private environment variables through client bundles, HTML, logs, source maps, or API responses.
- [ ] Apply environment-specific settings intentionally for development, preview, and production.
- [ ] Preserve authentication, authorization, RLS, CSRF protections where applicable, rate limits, and owner-only route controls.
- [ ] Never use SEO or robots rules as substitutes for access controls.

## 13. Verification and acceptance criteria

Do not mark this upgrade complete until the applicable checks have evidence:

1. Every intended public route loads directly and on refresh.
2. Unknown routes return a branded 404 with an actual 404 status.
3. Every indexable public page has a unique title, description, canonical URL, and clear H1.
4. Canonical URLs, redirects, sitemap entries, and robots rules agree with the deployed domain.
5. Private routes and user data remain protected and are not unintentionally indexed or cached publicly.
6. SSR/static output is validated for public pages, and authenticated app behavior remains correct.
7. Favicon, alt text, share previews, and structured data are checked.
8. Production browser-console and network checks show no unresolved actionable errors.
9. Bundle analysis and performance checks are compared with the recorded baseline.
10. Responsive, keyboard-accessibility, and reduced-motion checks pass where applicable.
11. Tests, lint, type checks, and production build pass.
12. Deployment is verified against the actual production URL; a passing local test alone is not proof of production success.
13. Documentation records changes, tests run, remaining issues, and evidence. Never claim an unverified deployment or completed task.

## 14. Implementation sequence

1. Audit routes, framework, deployment, metadata, current design system, dependencies, and baseline performance.
2. Create a route inventory showing public, authenticated, admin/owner-only, and non-indexable pages.
3. Fix routing, HTTP status codes, canonical domain behavior, and the 404 page.
4. Implement per-page metadata, heading structure, internal links, breadcrumbs, sitemap, and robots policy.
5. Improve brand consistency, favicon, image handling, social metadata, and valid structured data.
6. Optimize SSR/static rendering and bundle performance without breaking application behavior.
7. Resolve console errors, source-map exposure risks, placeholders, and content inconsistencies.
8. Run automated tests and production-like visual, SEO, accessibility, security, and performance checks.
9. Verify the live Vercel deployment and record evidence and remaining issues.

## 15. Claude execution instructions

- Read `CLAUDE.md`, `docs/CLAUDE_MASTER_PLAN_SUMMARY.md` (if present), and `docs/claude-code-handoff.md` before implementation.
- Inspect the repository before editing; do not assume a framework, route structure, or existing feature state.
- Make focused, reviewable changes and preserve unrelated work.
- Follow the repository's branch/PR workflow. Do not merge or deploy without owner authorization.
- Do not invent environment variables, API routes, credentials, business details, or test results.
- Do not claim a check passed unless it was run and its result was observed.
- Update the master summary and relevant detailed documentation with status, decisions, test results, deployment verification, and unresolved risks.
- Prefer production correctness, security, accessibility, and maintainability over cosmetic shortcuts.
