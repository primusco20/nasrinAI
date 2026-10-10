# Chat: streaming, Stop, Retry, Edit, Regenerate

## Streaming

`POST /v1/chat` with `"stream": true` answers as NDJSON (`application/x-ndjson`),
one JSON object per line:

| Event | Meaning |
|---|---|
| `start` | `conversation_id`, `user_message_id` (the message is saved) |
| `delta` | `text`: the next whole sentence(s), already cleaned |
| `reset` | a model attempt failed and another is tried: drop the text so far |
| `done` | the normal final reply (same shape as the non-streamed answer) |
| `error` | `code`, `message`: something failed after the stream started |

Only OpenAI (SSE, `stream_options.include_usage`) and the fake provider
stream; others answer in one piece. Replies with tool calls are not streamed.
Text is passed through `keepIdentity`, `cleanPiece` and the length cap a
sentence at a time (`liveText` in `src/chat.js`), so the screen never shows
text the final reply would not. Errors before `start` are normal JSON errors.
Whether Vercel delivers the stream in pieces cannot be verified from the
repository; the page also works when the whole answer arrives at once.

## Stop

Closing the request (the Stop button) aborts the model call. The part
already written is saved as the reply, and usage is estimated and counted,
so stopping cannot be used to get around limits.

## Regenerate, Retry, Edit

- `"regenerate": true` answers the last user message again; answers after it
  are deleted. Retry after an error uses the same path when the message was
  saved, otherwise it resends.
- `"edit_message_id"` must be the last user message: it and everything after
  it are deleted and the new text is answered.
- Picture turns cannot be regenerated or edited this way (use the picture's
  own Regenerate). Attachments are not resent.

## Read aloud

Listen → Pause → Resume, with a small Stop button while it plays. Works for
natural voices (Web Audio, `suspend`/`resume`) and the device voice
(`speechSynthesis.pause`/`resume`).

## Malformed archive metadata

Supported archive/document parsers must treat malformed manifest paths and other invalid archive metadata as unreadable or skip the invalid entry. User-supplied files must not cause an unhandled parser exception or take down a chat request. Regression tests belong in `test/attachments.test.js`; parsing stays bounded and never executes archive contents.
