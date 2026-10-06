# In-app notices

Short notes shown above the message box when the app opens or a new chat
starts. One at a time, never during a reply.

## Adding or changing a notice

Edit `config/notices.json` (no code change), then deploy:

```json
{
  "id": "chat-upgrade-2026-10",
  "type": "feature",
  "when": "open",
  "audience": "all",
  "title": "Replies now appear as they are written",
  "body": "Tap Stop to end a reply early ...",
  "until": "2026-11-06"
}
```

| Field | Values |
|---|---|
| `id` | lowercase letters, digits, `-` (max 64); new id = shown again to everyone. `plan-` is reserved |
| `type` | `info` (tip), `success`, `warning`, `error`, `security`, `feature` |
| `when` | `open`, `new_chat`, `both` |
| `audience` | `all`, `guest`, `user` (signed in) |
| `title` / `body` | plain text, max 80 / 240 characters |
| `from` / `until` | optional dates (`2026-11-06` = midnight UTC); `until` is not included |
| `action` | optional `{ "label": "...", "target": "plans" }`; targets: `plans`, `professional`, `privacy`, `security`, `signin`, `settings` (in-app only, never a link) |
| `requires` | optional `"professional"`: only while Professional AI is on |

A wrong entry is skipped with a warning in the logs; it never breaks the site.

## Rules

- At most 3 per moment, most important first (security, error, warning,
  feature, info, success).
- Settings → Notifications: "New features" (`feature`) and "Tips in new
  chats" (`info`, `success`) can be turned off. Security, warning and error
  always show.
- Closing a notice hides it for good. Signed in: kept with the account
  (`nasrin_prefs.seen`, newest 100); guests: on the device. Optional notices
  also count as seen once the person sends a message.
- Made by the server for one person: "plan ends soon" (3 days before a paid
  plan ends).

## API

- `GET /v1/notices?when=open|new_chat` — public list (guests).
- `GET /v1/notices/mine?when=...` — the caller's list (choices applied).
- `POST /v1/notices/:id/dismiss` — signed in only.
- `PUT /v1/settings` with `{ "notices": { "features": false } }`.
