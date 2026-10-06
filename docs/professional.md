# Professional AI

Universal AI (a general assistant) is the default. With **Professional AI**
on, answers are shaped by professional expertise (CEO, recruiter, developer,
finance…). The person turns it on and picks **Automatic** or **Choose**
(one, several, whole groups, or all) with the pill in the message box, or in
Settings > Professional AI. The choice is kept on the device.

- **Registry:** `src/ai/professions.js`: groups and professions (focus,
  method, output, safety rules, words for Automatic, accessory). A new
  profession is one new entry; `checkRegistry()` runs in the tests.
  The General Recruiter holds 15 recruitment specialties inside.
- **Orchestrator:** `src/ai/professional.js`. The server checks every choice
  (unknown ids or modes: 400 before anything is spent), then code (no model
  call) picks at most 3 professions the message needs, the ★ primary first;
  a second or third joins only when the message clearly points at it.
  Automatic and "all" fall back to Universal AI when nothing matches.
- **One answer, one call:** the chosen expertise goes into the system prompt
  of the single model call with an instruction to give one combined answer.
  Choosing many professions never multiplies the cost. Answers with
  professions are not cached.
- **Tiers and plans** are unchanged and enforced as before
  (`src/ai/models.js`); professions never raise a tier.
- **Scope:** NasrinAI's own chat only. Businesses' assistants, knowledge-only
  businesses and guests on business sites are unaffected.
- **Safety:** each profession carries boundaries (not a lawyer/doctor/licensed
  adviser, no authority, fairness in hiring, defensive security only).
- **Off switch:** `PROFESSIONAL_AI=false` in Vercel: Universal AI only, the
  pill disappears.
- `GET /v1/professionals`: names, groups and short focus lines for the page.
  The instructions stay on the server.
