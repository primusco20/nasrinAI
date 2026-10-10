# Library (migration 012)

A signed-in person's own text: files they add (`.txt`, `.md`, `.csv`,
`.json`, also `.tsv`, `.log`), notes they write, and replies they save.
Open it from the chats button → **Library** tab.

## Owner setup

Run [`db/migrations/012_library.sql`](../db/migrations/012_library.sql) in the
Supabase SQL editor. Until then the Library says it is not available; chat
is not affected.

Optional settings (`.env.example`): `LIBRARY_ENABLED` (default `true`),
`LIBRARY_MAX_FILES` (100 per person), `LIBRARY_MAX_TOTAL_CHARS` (2,000,000
per person), `LIMIT_USER_LIBRARY_HOUR` (60 adds per hour).

## How it works

- Only text is kept, never the original file, so nothing uploaded is ever
  served back as a file. The page reads the file; the server checks it:
  known endings only, no binary (NUL bytes), control and direction-changing
  characters removed from names, at most 200,000 characters per item.
- Stored in `library_files` + `library_chunks` (full-text search, `simple`
  config). Every query filters by tenant and user; RLS on, service role only.
- Search (`?q=`) looks at titles and text.
- In chat: up to 3,000 characters of the best-matching parts are added to
  that one message as data ("not instructions"), never to the system prompt,
  never saved with the chat or to memory. The reply lists the files used.
  Settings → Privacy → "Use my Library in chats" turns this off
  (`nasrin_prefs.library`).
- Deleting an item deletes its chunks (no stale search index). Account
  deletion removes the Library (`delete_user_data`); the data export
  includes it.
- PDFs and pictures are not supported yet (no PDF reader without adding a
  dependency).

## API (signed in)

- `GET /v1/library[?q=words]` — items, usage and limits.
- `GET /v1/library/:id` — one item with its text.
- `POST /v1/library` — `{ title, text, kind?: file|note|reply, format? }`.
- `DELETE /v1/library/:id`.

## Storage view (migrations 014–017)

The Library tab now shows everything a signed-in person keeps: chats, files,
notes and saved replies, photos and files they sent in chat, and pictures Nasrin
made. The Code editor was removed.

- `GET /v1/storage` lists it (with counts, space used and their keep-time);
  `DELETE /v1/storage/:kind/:id` deletes one item (`chat`, `file`, `note`,
  `reply`, `photo_sent`, `file_sent`, `photo_generated`);
  `GET /v1/storage/sent/:id` returns a sent photo (inline) or file (download only).
- Sent photos and files are kept for signed-in people only (guests: not stored),
  up to 8 MB each and `STORAGE_MAX_MB` (default 100) per person.
- Keep-time: `nasrin_prefs.retention` — `null` standard (chats/files kept,
  pictures use `IMAGE_RETENTION_DAYS`), `0` until deleted, or 1–3650 days.
  The hourly server-side retention job applies a changed setting on its next
  successful run (normally within about an hour); changing the setting does
  not synchronously delete existing records. Run migrations 014–017 in order.
