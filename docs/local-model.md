# Run NasrinAI on your own model

NasrinAI can answer with a model running on a computer you control instead of
OpenAI. Messages then go only to that computer. Why it works this way:
[ADR-004](decisions/004-local-model-runtime.md).

**Try it on a Preview deployment first.** With `AI_PROVIDER=local` the GPT
tiers and natural voices are off until Phase 4 adds the router that combines
both.

## What you need

- A computer that stays on while people chat. As a rough guide, a 7–8B model
  needs about 8 GB of free memory; a graphics card makes replies much faster.
  Without one, replies can take tens of seconds.
- A model server. The steps below use **Ollama**. llama.cpp (`llama-server`),
  LM Studio and vLLM work too: anything with an OpenAI-compatible `/v1` API.

## 1. Start the model

1. Install Ollama from ollama.com.
2. Download a model, for example:
   ```
   ollama pull llama3.1:8b
   ```
3. Check it answers on that computer:
   ```
   curl http://127.0.0.1:11434/v1/models
   ```
   The model name in the list is what goes in `LOCAL_AI_MODEL`.

## 2. Let Vercel reach it, privately

Vercel cannot see a computer at home. Publish the model server through a
tunnel with HTTPS, and make the tunnel accept only NasrinAI.

With Cloudflare (the domain must be on Cloudflare; menu names may differ slightly):

1. **Zero Trust > Networks > Tunnels:** create a tunnel, run the connector on
   the model computer, and add a public hostname such as
   `model.<your-domain>` pointing to `http://localhost:11434`.
   If Ollama answers 403, set the hostname's **HTTP Host Header** to
   `localhost:11434`.
2. **Zero Trust > Access > Service auth:** create a service token. Copy its
   Client ID and Client Secret once; they are shown only then.
3. **Zero Trust > Access > Applications:** add a self-hosted application for
   `model.<your-domain>` with one policy: action **Service Auth**, include the
   service token from step 2. Nobody without the token gets through.

Using llama.cpp instead? Start it with `--api-key <long random value>` and
put the same value in `LOCAL_AI_KEY`. It still needs an HTTPS tunnel.

Never open the model server's port on your router.

## 3. Settings in Vercel

**Settings > Environment Variables**, for the Preview environment first:

| Name | Value |
| --- | --- |
| `AI_PROVIDER` | `local` |
| `LOCAL_AI_URL` | `https://model.<your-domain>/v1` |
| `LOCAL_AI_MODEL` | `llama3.1:8b` (the name from step 1) |
| `LOCAL_AI_ACCESS_CLIENT_ID` | the service token's Client ID |
| `LOCAL_AI_ACCESS_CLIENT_SECRET` | the service token's Client Secret |

Optional:

- `TIER_PRO`, `TIER_MAX`, `TIER_ULTRA`: other models on the same server, for
  example `TIER_PRO=qwen2.5:14b`. A tier shows only if the server has that model.
- `LOCAL_AI_VISION=true` if the model can see photos (for example `llava`,
  `llama3.2-vision`). PDFs are not supported with a local model.
- `LOCAL_AI_TIMEOUT_SECONDS` (default 100, at most 115).

Redeploy. The server refuses to start if the URL is not `https://` or no
credential is set, and Vercel's **Logs** tab says which setting is wrong.

## 4. Check it

1. `https://<deployment>/v1/status` shows `"own_model": true` and
   `"ai_available": true`.
2. The page's small print says messages are not sent to an outside AI company.
3. Turn the model computer off: within 30 seconds the page says Nasrin is not
   switched on. Turn it back on and it returns by itself.

## Going back to OpenAI

Set `AI_PROVIDER=openai` and redeploy. Nothing else changes.
