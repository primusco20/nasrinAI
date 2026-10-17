import { ProviderError } from './provider.js';

// Cloudflare Workers AI uses an account-scoped endpoint rather than the usual
// OpenAI-compatible /chat/completions route.
export function createCloudflareWorkersAIProvider({ apiKey, accountId, model, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!apiKey || !accountId || !model) throw new Error('Cloudflare Workers AI needs API key, account ID and model');
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/ai/run/';
  return {
    id: 'cloudflare-workers-ai',
    model,
    capabilities: () => ({ local: false, dataLeavesServer: true, vision: false, pdf: false, tools: false, trainsOnData: true }),
    async generate({ system, messages, model: chosen, maxTokens = 800, signal }) {
      let resp;
      try {
        resp = await fetchImpl(base + String(chosen || model).split('/').map(encodeURIComponent).join('/'), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        if (signal?.aborted) throw new ProviderError('stopped', 'stopped by the person');
        throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'Cloudflare Workers AI could not be reached');
      }
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const status = resp.status;
        throw new ProviderError([401, 403, 400, 404].includes(status) ? 'config' : status === 429 ? 'busy' : 'unavailable', 'Cloudflare Workers AI rejected the request (' + status + ')', status);
      }
      const text = data?.result?.response ?? data?.result?.text ?? '';
      if (typeof text !== 'string') throw new ProviderError('unavailable', 'Cloudflare Workers AI returned an unsupported response');
      return { text, inputTokens: Number(data?.result?.usage?.prompt_tokens) || 0, outputTokens: Number(data?.result?.usage?.completion_tokens) || 0, finishReason: 'stop', model: chosen || model };
    },
    async listModels() { return [model]; },
    async healthCheck() { return true; }
  };
}
