import { ProviderError } from './provider.js';

// NasrinAI's own model, run on a machine the owner controls, through the
// OpenAI-compatible API that local model servers offer:
//   Ollama      http://<host>:11434/v1
//   llama.cpp   llama-server, http://<host>:8080/v1
//   LM Studio   http://<host>:1234/v1
//   vLLM        http://<host>:8000/v1
//
// Messages go only to that machine, never to an outside AI company.
// When the machine is reached over the internet (a tunnel), the server sends
// a credential with every call so nobody else can use the model server:
//   apiKey          -> Authorization: Bearer   (llama.cpp / vLLM --api-key, or a proxy)
//   accessClientId  -> CF-Access-Client-Id / CF-Access-Client-Secret (Cloudflare Access service token)
//
// Photos are sent only when the owner says the model can see (vision).
// PDFs are refused: local servers do not read them.
export function createLocalProvider({
  baseUrl,
  model,
  apiKey = '',
  accessClientId = '',
  accessClientSecret = '',
  vision = false,
  temperature = null,
  timeoutMs = 100_000,
  fetchImpl = fetch
}) {
  if (!baseUrl) throw new Error('LOCAL_AI_URL is required for the local provider');
  if (!model) throw new Error('LOCAL_AI_MODEL is required for the local provider');
  const root = baseUrl.replace(/\/+$/, '');

  const auth = {};
  if (apiKey) auth.Authorization = 'Bearer ' + apiKey;
  if (accessClientId) {
    auth['CF-Access-Client-Id'] = accessClientId;
    auth['CF-Access-Client-Secret'] = accessClientSecret;
  }

  // Never includes the URL's credentials or the keys; only what went wrong.
  const unreachable = (err) => (err?.name === 'TimeoutError' || err?.name === 'AbortError'
    ? new ProviderError('timeout', 'the local model did not answer in time')
    : new ProviderError('unavailable', 'the local model server could not be reached: ' + (err?.cause?.code || err?.name || 'error')));

  const provider = {
    id: 'local',
    model,
    capabilities: () => ({ local: true, dataLeavesServer: false, vision, pdf: false }),

    async generate({ system, messages, model: chosen, attachments = [], maxTokens = 800, signal }) {
      const useModel = chosen || model;
      if (attachments.some((a) => a.kind === 'pdf')) throw new ProviderError('config', 'the local model cannot read PDFs', 400);
      if (attachments.length && !vision) throw new ProviderError('config', 'the local model cannot see photos (LOCAL_AI_VISION is off)', 400);

      const turns = messages.map((m) => ({ role: m.role, content: m.content }));
      const last = turns.at(-1);
      if (attachments.length && last && last.role === 'user') {
        last.content = [{ type: 'text', text: last.content }]
          .concat(attachments.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } })));
      }
      const body = {
        model: useModel,
        messages: [{ role: 'system', content: system }, ...turns],
        max_tokens: maxTokens,
        stream: false
      };
      if (temperature !== null) body.temperature = temperature;

      const timeout = AbortSignal.timeout(timeoutMs);
      let resp;
      try {
        resp = await fetchImpl(root + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
      } catch (err) {
        throw unreachable(err);
      }

      if (!resp.ok) {
        const detail = (await resp.text().catch(() => '')).slice(0, 200);
        const s = resp.status;
        if (s === 401 || s === 403) throw new ProviderError('config', `the local model server refused NasrinAI's credential (${s})`, s);
        if (s === 400 || s === 404) throw new ProviderError('config', `the local model server rejected the request for ${useModel} (${s}): ${detail}`, s);
        if (s === 429 || s === 503) throw new ProviderError('busy', `the local model server is busy (${s})`, s);
        throw new ProviderError('unavailable', `the local model server answered ${s}: ${detail}`, s);
      }

      const data = await resp.json().catch(() => null);
      const choice = data?.choices?.[0];
      const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
      return {
        // Some local reasoning models write their thinking between <think> tags.
        text: text.replace(/<think>[\s\S]*?<\/think>\s*/g, ''),
        inputTokens: Number(data?.usage?.prompt_tokens) || 0,
        outputTokens: Number(data?.usage?.completion_tokens) || 0,
        finishReason: choice?.finish_reason || 'unknown',
        model: useModel
      };
    },

    // The models the server has ready (for Ollama: the ones pulled).
    async listModels() {
      let resp;
      try {
        resp = await fetchImpl(root + '/models', { headers: auth, signal: AbortSignal.timeout(8000) });
      } catch (err) {
        throw unreachable(err);
      }
      if (!resp.ok) throw new ProviderError(resp.status === 401 || resp.status === 403 ? 'config' : 'unavailable', `the local model list answered ${resp.status}`, resp.status);
      const data = await resp.json().catch(() => null);
      const ids = (Array.isArray(data?.data) ? data.data : []).map((m) => String(m?.id || '')).filter(Boolean);
      // Ollama lists "llama3.2:latest" for a model pulled as "llama3.2".
      return [...new Set(ids.flatMap((id) => (id.endsWith(':latest') ? [id, id.slice(0, -7)] : [id])))];
    },

    // True when the server answers and has the default model ready.
    async healthCheck() {
      try {
        return (await provider.listModels()).includes(model);
      } catch {
        return false;
      }
    }
  };
  return provider;
}
