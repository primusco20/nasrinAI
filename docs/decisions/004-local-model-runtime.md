# ADR-004: Local model runtime

- **Status:** Accepted
- **Date:** 2026-10-05
- **Builds on:** ADR-001 (combined model setup), ADR-003 (Vercel)

## Decision

NasrinAI talks to its own model through the **OpenAI-compatible HTTP API**
that local model servers already offer (`/v1/chat/completions`, `/v1/models`).
It is one more provider behind the provider interface (`src/ai/local.js`),
switched on with `AI_PROVIDER=local`.

The model server runs on a machine the owner controls. NasrinAI does not
install, start or update it.

## Context

- The API runs on Vercel functions. A function cannot hold a model in memory
  or use a GPU, so the model must run elsewhere and be called over the network.
- Ollama, llama.cpp (`llama-server`), LM Studio and vLLM all serve the same
  OpenAI-style chat API, so one small client covers all of them and the owner
  can change servers without a code change.
- ADR-002 rules out runtime packages; `fetch` is enough.

## Options considered

| Option | Verdict |
| --- | --- |
| Run the model inside the API process (llama.cpp bindings) | Not possible on Vercel; native packages break ADR-002 |
| Ollama's own API (`/api/chat`) | Works only with Ollama |
| OpenAI-compatible API | **Chosen**: Ollama, llama.cpp, LM Studio and vLLM |

## Security rules (enforced in `src/config.js`)

- In production, a model server on another machine must use `https://` and
  NasrinAI must send a credential: `LOCAL_AI_KEY` (bearer) or a Cloudflare
  Access service token (`LOCAL_AI_ACCESS_CLIENT_ID` / `_SECRET`). Ollama has no
  login of its own, so it must sit behind something that checks one.
- Credentials in the URL, query strings and fragments are refused, so they
  cannot end up in logs.
- The model server is never called by the browser and its address is never
  sent to the page.
- The status route checks the model server at most every 30 seconds, so the
  public page cannot be used to flood it.
- Photos are sent only with `LOCAL_AI_VISION=true`; PDFs are refused before
  any call.
- Model output passes through the same checks as any other provider.

## Consequences

- Messages go only to the owner's machine, so nothing is removed from them
  and the page says they are not sent to an outside AI company.
- When that machine is off or asleep, the page says Nasrin is not switched on.
  Falling back to OpenAI is the router's job (Phase 4), as ADR-001 planned.
- Natural voices use OpenAI and are off with `AI_PROVIDER=local` for now;
  the phone's own voice still works.
- What the model server logs is outside NasrinAI. The owner should check it.
- Tested here against a stand-in server that answers like Ollama; no real
  model could be downloaded in the build environment.
