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
2. Chat asks the model with the caller's tools and runs what it asks for
   (at most 2 rounds per message, counted in the routing budget).
3. Confirm card in the chat for `write` / `money` tools.
4. More tools as connectors arrive (Phase 6).
