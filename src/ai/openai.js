import { ProviderError } from './provider.js';

// Reasoning models (o-series, GPT-5 family except its "chat" variants) spend
// part of their token allowance thinking, reject a custom temperature, and
// accept a reasoning effort.
export const isReasoningModel = (model) => /^o\d/.test(model) || (/^gpt-5/.test(model) && !/chat/.test(model));

// OpenAI through its Chat Completions API, called with fetch (no SDK).
// The key is read from the environment and only ever sent to OpenAI.
export function createOpenAIProvider({
  apiKey,
  model = 'gpt-4o-mini',
  temperature = null,
  reasoningMaxTokens = 4000,
  reasoningEffort = 'low',
  baseUrl = 'https://api.openai.com/v1',
  timeoutMs = 110_000,
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the openai provider');

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };

  return {
    id: 'openai',
    model,
    capabilities: () => ({ local: false, dataLeavesServer: true }),

    async generate({ system, messages, model: chosen, reasoningEffort: effortOverride, maxTokens = 800, signal }) {
      const useModel = chosen || model;
      const reasoning = isReasoningModel(useModel);
      const effort = effortOverride || reasoningEffort;
      // A reasoning model's thinking counts against this allowance too, so it
      // gets a larger one (more for more effort) or its answer can come back empty.
      const thinking = Math.min(32000, reasoningMaxTokens * ({ medium: 2, high: 4 }[effort] || 1));
      const body = {
        model: useModel,
        messages: [{ role: 'system', content: system }, ...messages],
        max_completion_tokens: reasoning ? Math.max(maxTokens, thinking) : maxTokens
      };
      if (reasoning && effort) body.reasoning_effort = effort;
      if (!reasoning && temperature !== null) body.temperature = temperature;

      const timeout = AbortSignal.timeout(timeoutMs);
      let resp;
      try {
        resp = await fetchImpl(baseUrl + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new ProviderError('timeout', 'OpenAI did not answer in time');
        throw new ProviderError('unavailable', 'OpenAI could not be reached: ' + (err?.name || 'error'));
      }

      if (!resp.ok) {
        const detail = (await resp.text().catch(() => '')).slice(0, 200);
        const s = resp.status;
        if (s === 401 || s === 403) throw new ProviderError('config', `OpenAI refused the API key or model (${s})`, s);
        if (s === 429) throw new ProviderError('busy', `OpenAI rate limit or quota (${s}): ${detail}`, s);
        if (s === 400 || s === 404) throw new ProviderError('config', `OpenAI rejected the request for ${useModel} (${s}): ${detail}`, s);
        throw new ProviderError('unavailable', `OpenAI answered ${s}: ${detail}`, s);
      }

      const data = await resp.json().catch(() => null);
      const choice = data?.choices?.[0];
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        inputTokens: Number(data?.usage?.prompt_tokens) || 0,
        outputTokens: Number(data?.usage?.completion_tokens) || 0,
        finishReason: choice?.finish_reason || 'unknown',
        model: useModel
      };
    },

    // Every model id this key can use. Filtering to chat models happens in models.js.
    async listModels() {
      let resp;
      try {
        resp = await fetchImpl(baseUrl + '/models', {
          headers: { Authorization: 'Bearer ' + apiKey },
          signal: AbortSignal.timeout(8000)
        });
      } catch (err) {
        throw new ProviderError('unavailable', 'OpenAI model list could not be fetched: ' + (err?.name || 'error'));
      }
      if (!resp.ok) throw new ProviderError(resp.status === 401 ? 'config' : 'unavailable', `OpenAI model list answered ${resp.status}`, resp.status);
      const data = await resp.json().catch(() => null);
      return (Array.isArray(data?.data) ? data.data : []).map((m) => String(m?.id || '')).filter(Boolean);
    },

    async healthCheck() {
      try {
        const r = await fetchImpl(baseUrl + '/models/' + encodeURIComponent(model), {
          headers: { Authorization: 'Bearer ' + apiKey },
          signal: AbortSignal.timeout(5000)
        });
        return r.ok;
      } catch {
        return false;
      }
    }
  };
}
