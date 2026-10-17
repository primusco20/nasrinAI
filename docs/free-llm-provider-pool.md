# Free LLM API provider pool

NasrinAI uses the upstream provider directory as its catalog reference:
https://github.com/open-free-llm-api/awesome-freellm-apis

The upstream project is a frequently updated directory, not a single API key or a single SDK. Each provider requires its own account/credential, and each model has its own availability, free quota, privacy terms, and protocol. This implementation keeps credentials server-side and enables a provider only when it has a server-side key and a pinned model.

## Providers in the catalog

| Directory provider | NasrinAI ID | Adapter / notes |
|---|---|---|
| NVIDIA NIM | `nvidia-nim` | OpenAI-compatible |
| ModelScope | `modelscope` | OpenAI-compatible |
| Cloudflare Workers AI | `cloudflare-workers-ai` | Account-scoped Workers AI API |
| OpenCode Zen | `opencode-zen` | OpenAI-compatible |
| OpenRouter | `openrouter` | OpenAI-compatible; free model IDs often include a `:free` suffix |
| LLM7.io | `llm7` | OpenAI-compatible |
| Kilo Code | `kilo-code` | OpenAI-compatible |
| Google Gemini | `gemini` | Existing native Gemini adapter |
| Ollama Cloud | `ollama-cloud` | OpenAI-compatible endpoint |
| Mistral AI | `mistral` | OpenAI-compatible |
| OVHcloud AI Endpoints | `ovhcloud-ai-endpoints` | OpenAI-compatible |
| Groq | `groq` | OpenAI-compatible |
| Cohere | `cohere` | Dedicated v2 Chat adapter |
| Aion Labs | `aion-labs` | OpenAI-compatible |
| Hugging Face | `hugging-face` | OpenAI-compatible router |
| Z AI (Zhipu AI) | `z-ai` | OpenAI-compatible |
| Cerebras | `cerebras` | OpenAI-compatible |
| Agnes AI | `agnes-ai` | OpenAI-compatible |
| Alibaba Cloud Model Studio | `alibaba-cloud-model-studio` | OpenAI-compatible |
| SiliconFlow | `siliconflow` | OpenAI-compatible |
| SambaNova | `sambanova` | OpenAI-compatible |
| Cline | `cline` | Listed for tracking; upstream directory currently gives no public API base URL |
| xAI | `xai` | OpenAI-compatible |
| Chutes.ai | `chutes` | OpenAI-compatible |
| Glhf.chat | `glhf-chat` | OpenAI-compatible |
| Grok (xAI alias) | `grok` | Same xAI endpoint; do not configure as a separate backend |
| AI21 Labs | `ai21-labs` | OpenAI-compatible endpoint; verify current free quota |
| DeepSeek | `deepseek` | OpenAI-compatible endpoint; verify current free quota |
| Nscale | `nscale` | OpenAI-compatible |
| Nebius | `nebius` | OpenAI-compatible |

## Environment variable pattern

For each provider with a supported adapter, add these variables in **Vercel → Project → Settings → Environment Variables**. Never commit real keys to GitHub and never expose them in browser code.

- `<PROVIDER_ENV>_API_KEY`: provider credential
- `<PROVIDER_ENV>_MODEL`: exact model ID to use
- `<PROVIDER_ENV>_FREE_MODELS`: comma-separated exact model IDs verified as free on that provider today

The `<PROVIDER_ENV>` prefix is shown in `src/ai/free-provider-catalog.js`. For example:

```text
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_FREE_MODELS=llama-3.3-70b-versatile
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=provider/model:free
OPENROUTER_FREE_MODELS=provider/model:free
```

These model IDs are examples only. Confirm the current model ID and its free status in the provider dashboard and the upstream directory before enabling them.

Cloudflare Workers AI additionally needs `CLOUDFLARE_ACCOUNT_ID`. Gemini continues to use `GEMINI_API_KEY` and the existing Gemini configuration. Cohere uses `COHERE_API_KEY`, `COHERE_MODEL`, and `COHERE_FREE_MODELS`.

## Routing and safety rules

1. A provider is enabled only when its key and model are configured.
2. A provider is a free routing candidate only when the selected model is an exact match in its `*_FREE_MODELS` allowlist.
3. Only exact allowlisted free model IDs receive zero estimated model cost. An unknown model is not assumed free.
4. Free-provider requests are treated as external and potentially training/logging-enabled. Sensitive messages and attachments are not sent to these providers by default.
5. The existing tier ceiling, per-user/hourly abuse controls, budget checks, response validation, retry bounds, and fallback policy remain in force.
6. Image, video, realtime voice, and speech generation are separate capabilities; a text-chat API is not assumed to support them.
7. The catalog records endpoints and adapter types; it does not claim every model stays free. Free quotas, model IDs, and terms change upstream. Review the source before changing the free-model allowlist.
8. Cline is retained as a directory entry but is not activated as an inference API until the source provides a public endpoint. Grok is an xAI alias, not an additional independent provider.

## Upstream reference

- Provider list and key links: https://github.com/open-free-llm-api/awesome-freellm-apis
- Live model directory: https://freellm.net/models/
- Key directory: https://freellm.net/free-llm-api-keys/
