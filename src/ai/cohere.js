import { ProviderError } from './provider.js';

// Cohere's v2 Chat API has a different request/response shape from OpenAI.
export function createCohereProvider({ apiKey, model, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!apiKey || !model) throw new Error('Cohere needs API key and model');
  return {
    id: 'cohere',
    model,
    capabilities: () => ({ local: false, dataLeavesServer: true, vision: false, pdf: false, tools: false, trainsOnData: true }),
    async generate({ system, messages, model: chosen, maxTokens = 800, signal }) {
      let resp;
      try {
        resp = await fetchImpl('https://api.cohere.com/v2/chat', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: chosen || model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens }),
          signal: signal || AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        if (signal?.aborted) throw new ProviderError('stopped', 'stopped by the person');
        throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'Cohere could not be reached');
      }
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const status = resp.status;
        throw new ProviderError([401, 403, 400, 404].includes(status) ? 'config' : status === 429 ? 'busy' : 'unavailable', 'Cohere rejected the request (' + status + ')', status);
      }
      const text = Array.isArray(data?.message?.content) ? data.message.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('') : '';
      return { text, inputTokens: Number(data?.usage?.billed_units?.input_tokens) || 0, outputTokens: Number(data?.usage?.billed_units?.output_tokens) || 0, finishReason: data?.finish_reason || 'stop', model: chosen || model };
    },
    async listModels() { return [model]; },
    async healthCheck() { return true; }
  };
}
