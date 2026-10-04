import { ProviderError } from './provider.js';

// OpenAI through its Chat Completions API, called with fetch (no SDK).
// The key is read from the environment and only ever sent to OpenAI.
export function createOpenAIProvider({
  apiKey,
  model = 'gpt-4o-mini',
  temperature = null,
  baseUrl = 'https://api.openai.com/v1',
  timeoutMs = 30_000,
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the openai provider');

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };

  return {
    id: 'openai',
    model,
    capabilities: () => ({ local: false, dataLeavesServer: true }),

    async generate({ system, messages, maxTokens = 800, signal }) {
      const body = {
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        max_completion_tokens: maxTokens
      };
      if (temperature !== null) body.temperature = temperature;

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
        if (resp.status === 401 || resp.status === 403) throw new ProviderError('config', `OpenAI refused the API key (${resp.status})`);
        if (resp.status === 429) throw new ProviderError('busy', `OpenAI rate limit or quota (${resp.status}): ${detail}`);
        if (resp.status === 400 || resp.status === 404) throw new ProviderError('config', `OpenAI rejected the request (${resp.status}): ${detail}`);
        throw new ProviderError('unavailable', `OpenAI answered ${resp.status}: ${detail}`);
      }

      const data = await resp.json().catch(() => null);
      const choice = data?.choices?.[0];
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        inputTokens: Number(data?.usage?.prompt_tokens) || 0,
        outputTokens: Number(data?.usage?.completion_tokens) || 0,
        finishReason: choice?.finish_reason || 'unknown'
      };
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
