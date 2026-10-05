# Tool engine (Phase 5)

Tools are things code does for Nasrin. The model may only **ask** for a tool;
code in `src/tools/registry.js` decides whether the call runs.

```
model asks -> known tool? -> caller's type allowed? -> arguments parse (≤ 4 KB)
  and match the tool's schema exactly (no extra keys) -> risk: 'read' runs;
  'write' / 'money' need the person's Confirm (never the model's say-so)
  -> run with a 3 s limit -> result ≤ 8 KB -> usage record (tool, outcome,
  time; no arguments, no results)
```

Tenant and person come from the credential (`ctx`), never from arguments, so
a tool cannot reach someone else's data.

| Tool | Risk | What it does |
| --- | --- | --- |
| `calculate` | read | Exact arithmetic (same parser as the no-model answers) |
| `current_time` | read | Date and time in an IANA time zone (default Asia/Manila) |
| `convert_units` | read | Length, mass, volume, temperature |

Steps:

1. Registry, argument checks, permissions, risk, audit, first tools. **Done.**
2. Chat runs tools. **Done.** With smart routing, a message that may need a
   tool (numbers, units, time or date words) is sent with the caller's tools.
   When the model asks, code runs the calls (at most 3 per round, 2 rounds;
   the last round must answer in words), sends the results back, and the
   model answers. Every model call is recorded and counted in the chat
   budget; answers that used tools are never cached. A service that rejects
   the tool list answers without it. Tools go to OpenAI and Gemini; local
   model servers get none. `TOOLS_ENABLED=false` turns tools off.
3. Confirm card. **Done.** A `write` / `money` call is not run: the chat
   reply carries `pending_action` (a signed, single-use token, 10 minutes,
   with a summary built by code from the declared description and checked
   arguments). The page shows **Confirm** / **Cancel**;
   `POST /v1/actions/confirm` or `/cancel` with `{ token }` (same caller
   only) re-checks everything and runs it once. Business servers using the
   API confirm the same way.
4. More tools as connectors arrive (Phase 6).
