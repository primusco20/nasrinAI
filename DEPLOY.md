# Deploy: website knowledge (SmartChat reads verified websites)

## What is in this zip
`changed/` is your full uploaded folder with these 7 files modified or added.
Copy them over your repo, keeping the same paths:

| File | Change |
|---|---|
| src/connect/site-knowledge.js | NEW: crawler, robots.txt, text extraction |
| src/connect/index.js | crawl/read/remove knowledge, purge on site removal |
| src/routes.js | 3 new routes under /v1/connect/sites/:id/knowledge |
| src/main.js | wires the knowledge store into Connect |
| public/app.js | "Read my website" button, auto-read after Verify |
| public/connect/dashboard.js | client calls for the new routes |
| test/site-knowledge.test.js | NEW: 10 tests |

Do not copy anything else from this zip over your repo; the rest is unchanged.

## Database
No migration needed. Crawl bookkeeping is stored in the existing
`connect_installations.metadata` column (key `knowledge`).

## Before you deploy
1. Open `src/main.js`, find `knowledgeSink`. It calls
   `knowledge.manage.add(caller, { title, content, source_url })`.
   I could not see src/knowledge/, so confirm those field names match.
   If they differ, change only that block.
2. Run `npm test` (the new tests need src/http/errors.js from your repo).

## Deploy order (staging first, per docs/nasrinai-connect-implementation.md)
1. Push a branch, deploy to the non-production Vercel project (staging Supabase).
2. For production verification, test on nasrinai.com:
   - Analyze + Verify the site; "Website authorized and read" should appear.
   - Dashboard shows "SmartChat knows N pages".
   - Ask SmartChat a question answered only by a page on the site.
   - Click "Re-read my website": page count stays correct, no duplicates.
   - Remove the site: its knowledge documents disappear.
3. Only then merge to main for production.

## New API
- GET    /v1/connect/sites/:id/knowledge
- POST   /v1/connect/sites/:id/knowledge/crawl   (verified sites only)
- DELETE /v1/connect/sites/:id/knowledge

## Known limits
- Reads plain HTML only (not pages that need JavaScript to show text).
- Max 25 pages, 90 seconds per read.
- Installing the widget on a customer site is still the manual script line.
