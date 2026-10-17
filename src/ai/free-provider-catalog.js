// Provider catalog sourced from open-free-llm-api/awesome-freellm-apis.
// Provider names and endpoints are metadata, not a guarantee that every model is
// free forever. Pin a model and enable a provider only after checking its current
// free-tier terms. Credentials and model IDs are configured in Vercel.
export const FREE_LLM_CATALOG_SOURCE = 'https://github.com/open-free-llm-api/awesome-freellm-apis';
export const FREE_LLM_CATALOG_REVIEWED = '2026-10-15';

export const FREE_LLM_CATALOG = Object.freeze([
  { id: 'nvidia-nim', env: 'NVIDIA_NIM', adapter: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com/settings/api-keys' },
  { id: 'modelscope', env: 'MODELSCOPE', adapter: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.cn/v1', keyUrl: 'https://modelscope.cn/my/myaccesstoken' },
  { id: 'cloudflare-workers-ai', env: 'CLOUDFLARE_WORKERS_AI', adapter: 'cloudflare-workers-ai', baseUrl: 'https://api.cloudflare.com/client/v4/accounts', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
  { id: 'opencode-zen', env: 'OPENCODE_ZEN', adapter: 'openai-compatible', baseUrl: 'https://opencode.ai/zen/v1', keyUrl: 'https://opencode.ai/auth' },
  { id: 'openrouter', env: 'OPENROUTER', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/workspaces/default/keys' },
  { id: 'llm7', env: 'LLM7', adapter: 'openai-compatible', baseUrl: 'https://api.llm7.io/v1', keyUrl: 'https://token.llm7.io' },
  { id: 'kilo-code', env: 'KILO_CODE', adapter: 'openai-compatible', baseUrl: 'https://api.kilo.ai/api/gateway', keyUrl: 'https://app.kilo.ai/profile' },
  { id: 'gemini', env: 'GEMINI', adapter: 'native-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'ollama-cloud', env: 'OLLAMA_CLOUD', adapter: 'openai-compatible', baseUrl: 'https://ollama.com/v1', keyUrl: 'https://ollama.com/settings/keys' },
  { id: 'mistral', env: 'MISTRAL', adapter: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'ovhcloud-ai-endpoints', env: 'OVHCLOUD_AI_ENDPOINTS', adapter: 'openai-compatible', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', keyUrl: 'https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/' },
  { id: 'groq', env: 'GROQ', adapter: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'cohere', env: 'COHERE', adapter: 'cohere-v2', baseUrl: 'https://api.cohere.com/v2', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'aion-labs', env: 'AION_LABS', adapter: 'openai-compatible', baseUrl: 'https://api.aionlabs.ai/v1', keyUrl: 'https://www.aionlabs.ai/app/api-keys/' },
  { id: 'hugging-face', env: 'HUGGING_FACE', adapter: 'openai-compatible', baseUrl: 'https://router.huggingface.co/v1', keyUrl: 'https://huggingface.co/settings/tokens' },
  { id: 'z-ai', env: 'Z_AI', adapter: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'cerebras', env: 'CEREBRAS', adapter: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/' },
  { id: 'agnes-ai', env: 'AGNES_AI', adapter: 'openai-compatible', baseUrl: 'https://apihub.agnes-ai.com/v1', keyUrl: 'https://platform.agnes-ai.com/settings/apiKeys' },
  { id: 'alibaba-cloud-model-studio', env: 'ALIBABA_CLOUD_MODEL_STUDIO', adapter: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
  { id: 'siliconflow', env: 'SILICONFLOW', adapter: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'sambanova', env: 'SAMBANOVA', adapter: 'openai-compatible', baseUrl: 'https://api.sambanova.ai/v1', keyUrl: 'https://cloud.sambanova.ai/apis' },
  // The directory does not currently list a public API endpoint for Cline itself.
  { id: 'cline', env: 'CLINE', adapter: 'no-public-endpoint', baseUrl: '', keyUrl: '' },
  { id: 'xai', env: 'XAI', adapter: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  { id: 'chutes', env: 'CHUTES', adapter: 'openai-compatible', baseUrl: 'https://api.chutes.ai/v1', keyUrl: 'https://chutes.ai/' },
  { id: 'glhf-chat', env: 'GLHF_CHAT', adapter: 'openai-compatible', baseUrl: 'https://glhf.chat/api/openai/v1', keyUrl: 'https://glhf.chat/' },
  // "Grok" is a second directory label for xAI, not a separate API endpoint.
  { id: 'grok', env: 'GROK', adapter: 'alias', aliasOf: 'xai', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/' },
  { id: 'ai21-labs', env: 'AI21_LABS', adapter: 'openai-compatible', baseUrl: 'https://api.ai21.com/studio/v1', keyUrl: 'https://studio.ai21.com/account/api-key' },
  { id: 'deepseek', env: 'DEEPSEEK', adapter: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'nscale', env: 'NSCALE', adapter: 'openai-compatible', baseUrl: 'https://inference.api.nscale.com/v1', keyUrl: 'https://console.nscale.com/' },
  { id: 'nebius', env: 'NEBIUS', adapter: 'openai-compatible', baseUrl: 'https://api.studio.nebius.com/v1', keyUrl: 'https://studio.nebius.com/settings/api-keys' }
]);
