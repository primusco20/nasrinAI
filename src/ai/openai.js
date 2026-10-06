import { ProviderError } from './provider.js';
import { toChatTurns, readToolCalls } from './tool-format.js';

// Reasoning models (o-series, GPT-5 and GPT-6 families except "chat" variants)
// spend part of their token allowance thinking, reject a custom temperature,
// and accept a reasoning effort.
export const isReasoningModel = (model) => /^o\d/.test(model) || (/^gpt-[56]/.test(model) && !/chat/.test(model));

// A streamed answer (server-sent events): text pieces go to onText as they
// arrive; the last event carries the token counts. A dropped connection is
// 'unavailable'; the person stopping it is 'stopped'.
async function readStream(resp, { onText, signal, useModel }) {
  let text = '';
  let finishReason = 'unknown';
  let usage = null;
  let buffer = '';
  const decoder = new TextDecoder();
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    if (data.usage) usage = data.usage;
    const choice = data.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const piece = choice.delta?.content;
    if (typeof piece === 'string' && piece) { text += piece; onText(piece); }
  };
  try {
    for await (const chunk of resp.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, i).trim()); buffer = buffer.slice(i + 1); }
    }
    if (buffer.trim()) handle(buffer.trim());
  } catch (err) {
    if (signal?.aborted) throw new ProviderError('stopped', 'stopped by the person');
    if (err?.name === 'TimeoutError') throw new ProviderError('timeout', 'OpenAI stopped answering in time');
    throw new ProviderError('unavailable', 'OpenAI stream was cut off: ' + (err?.name || 'error'));
  }
  return {
    text,
    toolCalls: [],
    inputTokens: Number(usage?.prompt_tokens) || 0,
    cachedTokens: Number(usage?.prompt_tokens_details?.cached_tokens) || 0,
    outputTokens: Number(usage?.completion_tokens) || Math.ceil(text.length / 4),
    finishReason,
    model: useModel
  };
}

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
    capabilities: () => ({ local: false, dataLeavesServer: true, tools: true }),

    async generate({ system, messages, model: chosen, reasoningEffort: effortOverride, attachments = [], tools = null, maxTokens = 800, signal, onText }) {
      const useModel = chosen || model;
      const reasoning = isReasoningModel(useModel);
      const effort = effortOverride || reasoningEffort;
      // A reasoning model's thinking counts against this allowance too, so it
      // gets a larger one (more for more effort) or its answer can come back empty.
      const thinking = Math.min(32000, reasoningMaxTokens * ({ none: 0.25, minimal: 0.5, medium: 2, high: 4, xhigh: 6, max: 8 }[effort] || 1));
      // Photos and PDFs join the latest user message as content parts.
      const turns = toChatTurns(messages);
      const last = turns.at(-1);
      if (attachments.length && last && last.role === 'user') {
        last.content = [{ type: 'text', text: last.content }].concat(attachments.map((a) => (a.kind === 'pdf'
          ? { type: 'file', file: { filename: a.name, file_data: `data:application/pdf;base64,${a.data}` } }
          : { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } })));
      }
      const body = {
        model: useModel,
        messages: [{ role: 'system', content: system }, ...turns],
        max_completion_tokens: reasoning ? Math.max(maxTokens, thinking) : maxTokens
      };
      if (tools?.length) body.tools = tools;
      if (reasoning && effort) body.reasoning_effort = effort;
      if (!reasoning && temperature !== null) body.temperature = temperature;
      // Streaming: only for plain answers (tool calls are read whole).
      const streaming = typeof onText === 'function' && !tools?.length;
      if (streaming) { body.stream = true; body.stream_options = { include_usage: true }; }

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
        if (signal?.aborted) throw new ProviderError('stopped', 'stopped by the person');
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

      if (streaming) return readStream(resp, { onText, signal, useModel });

      const data = await resp.json().catch(() => null);
      const choice = data?.choices?.[0];
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        toolCalls: tools?.length ? readToolCalls(choice?.message) : [],
        inputTokens: Number(data?.usage?.prompt_tokens) || 0,
        cachedTokens: Number(data?.usage?.prompt_tokens_details?.cached_tokens) || 0,
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
