# Knowledge and memory (Phase 7)

## Knowledge: a business's own documents

Owner: run [migration 009](../db/migrations/009_knowledge_memory.sql), then
give the business key the `knowledge` scope:

```sql
update public.api_keys set scopes = array_append(scopes, 'knowledge') where id = '<12-character key id>';
```

The business (server to server, its secret key):

```
POST /v1/knowledge   { "title": "Menu", "text": "...", "who": ["guest", "user", "service"] }
POST /v1/knowledge   { "url": "https://shop.example.com/faq" }      (page read safely, like shared links)
GET  /v1/knowledge   DELETE /v1/knowledge/<id>
```

Up to 200 documents of 200,000 characters each; split into chunks of at
most 1,200 characters. `who` (default all three) says who may see it:
`service` (the business's server), `guest` (visitors on its site or
Messenger), `user` (signed-in people of that business).

When someone asks something, code searches the business's chunks with
Postgres full-text search (no AI call, no cost; works for English, Filipino
and Bisaya alike), keeps the best 4 (at most 3,000 characters) and adds them
to that turn as data with their titles, so Nasrin can say which document it
used. Nothing is added when nothing matches. Other businesses never see it.

## Knowledge only (migration 011)

A business can be limited to its own documents (for example Nasrin's
portfolio chat). Owner: run [migration 011](../db/migrations/011_knowledge_only.sql),
then switch it on for that business:

```sql
update public.tenants set knowledge_only = true where name = 'Nasrin Portfolio';
-- optional: its own reply for off-topic questions (1 to 500 characters)
update public.tenants set off_topic_reply = 'I can help with Nasrin''s services, projects and pricing. What would you like to know?' where name = 'Nasrin Portfolio';
```

Then, for that business:

- A message its documents do not cover gets a fixed, polite reply with **no
  AI call** (free). "Hi" and "thank you" get a short friendly reply instead.
  A follow-up ("and the price?") is looked up together with the previous
  question; a file sent for a quote is matched against the services and prices.
- A message that matches is answered from the matching parts only, with a
  rule to use nothing else and to say so when the documents do not answer.
- Web search, reading links, calculations, tools, founder knowledge and
  memory are off. Attached files still work.
- The platform (nasrinai.site) and other businesses are unchanged. Changes
  apply within a minute (the server keeps a business's settings for 60 s).
- Before migration 011 runs, everything works as before (the setting reads as off).

Switch it on only after the business's documents are in NasrinAI, or every
question gets the fixed reply.

## The founder's portfolio (NasrinAI's own site)

Set `FOUNDER_KNOWLEDGE_URL` in Vercel to the address of the public portfolio
text (for example `https://nasrinai.com/api/knowledge`, once that page is
live). On nasrinai.site, questions about Nasrin Abubakar (services, projects,
story, "who made you?") are answered from the matching parts of it. It is
read safely like shared links, kept for 6 hours, and skipped if it cannot be
read. Businesses' chats do not get it. Nasrin is told not to share personal
details of anyone else mentioned in it, nor of any private person.

## Memory: what a signed-in person asks Nasrin to remember

- Nasrin can propose a note with the `remember` tool; the person must tap
  **Confirm** (so a web page or file cannot plant a memory).
- Up to 50 notes of 300 characters. The relevant ones (at most 1,200
  characters) are added to later turns.
- Settings > Your data > **What Nasrin remembers**: see and delete notes, or
  forget everything. `GET /v1/memories`, `DELETE /v1/memories[/<id>]`.
- Included in **Download my data**; deleted with the account.
- Settings > Privacy > **Memory** off: the `remember` tool is not offered or
  run, and saved notes are not added to chats (enforced on the server).
- Guests have no memory.
