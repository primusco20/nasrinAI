import { ProviderError } from './provider.js';
import { MAX_CALLS_PER_TURN } from './tool-format.js';

// Anthropic Messages API adapter. It deliberately uses the same provider
// contract as OpenAI/Gemini so routing, privacy, budgets and telemetry remain
// vendor-neutral. Tool execution stays conservative until the Anthropic
// tool-format adapter is explicitly enabled; ordinary text/coding work is safe.
export function createAnthropicProvider({ apiKey, model = 'claude-haiku-5-5', timeoutMs = 110_000, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
  return {
    id: 'anthropic',
    model,
    capabilities: () => ({ local: false, dataLeavesServer: true, vision: true, pdf: true, tools: false, trainsOnData: false }),
    async generate({ system, messages, model: chosen, maxTokens = 800, signal, onText, reasoningEffort }) {
      const useModel = chosen || model;
      const body = {
        model: useModel,
        max_tokens: Math.max(1, maxTokens),
        system: system || undefined,
        messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
      };
      // Anthropic's current API exposes adaptive thinking on supported models;
      // keep it opt-in and map our effort levels conservatively.
      if (reasoningEffort && reasoningEffort !== 'none') {
        body.thinking = { type: 'adaptive' };
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      let resp;
      try {
        resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers, body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
      } catch (err) {
        if (signal?.aborted) throw new ProviderError('stopped', 'stopped by the person');
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new ProviderError('timeout', 'Anthropic did not answer in time');
        throw new ProviderError('unavailable', 'Anthropic could not be reached: ' + (err?.name || 'error'));
      }
      if (!resp.ok) {
        const detail = (await resp.text().catch(() => '')).slice(0, 200);
        const s = resp.status;
        if (s === 401 || s === 403) throw new ProviderError('config', `Anthropic refused the API key or model (${s})`, s);
        if (s === 429) throw new ProviderError('busy', `Anthropic rate limit or quota (${s}): ${detail}`, s);
        if (s === 400 || s === 404) throw new ProviderError('config', `Anthropic rejected the request for ${useModel} (${s}): ${detail}`, s);
        throw new ProviderError('unavailable', `Anthropic answered ${s}: ${detail}`, s);
      }
      const data = await resp.json().catch(() => null);
      const text = Array.isArray(data?.content)
        ? data.content.filter((b) => b?.type === 'text').map((b) => String(b.text || '')).join('')
        : '';
      if (typeof onText === 'function' && text) onText(text);
      return {
        text,
        toolCalls: [],
        inputTokens: Number(data?.usage?.input_tokens) || 0,
        cachedTokens: Number(data?.usage?.cache_read_input_tokens) || 0,
        outputTokens: Number(data?.usage?.output_tokens) || 0,
        finishReason: data?.stop_reason || 'unknown',
        model: useModel
      };
    },
    async listModels() {
      // Anthropic's model-list endpoint is optional for routing; configured IDs
      // are trusted when the list cannot be queried.
      let resp;
      try {
        resp = await fetchImpl('https://api.anthropic.com/v1/models?limit=100', { headers, signal: AbortSignal.timeout(8000) });
      } catch { throw new ProviderError('unavailable', 'Anthropic model list could not be fetched'); }
      if (!resp.ok) throw new ProviderError(resp.status === 401 ? 'config' : 'unavailable', `Anthropic model list answered ${resp.status}`, resp.status);
      const data = await resp.json().catch(() => null);
      return (Array.isArray(data?.data) ? data.data : []).map((m) => String(m?.id || '')).filter(Boolean);
    },
    async healthCheck() {
      try {
        const r = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', { headers, signal: AbortSignal.timeout(5000) });
        return r.ok;
      } catch { return false; }
    }
  };
}
