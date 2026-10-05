import { ProviderError } from '../ai/provider.js';

// Web search through OpenAI's Responses API built-in tool
// (tools: [{ type: "web_search" }]), which returns an answer with url_citation
// annotations. The model is a setting (WEB_SEARCH_MODEL); check on OpenAI's
// web-search guide that your model supports the tool.
export function createWebSearch({ apiKey, model, fetchImpl = fetch, timeoutMs = 60_000, baseUrl = 'https://api.openai.com/v1' }) {
  return {
    model,
    async search({ system, messages, maxTokens = 1200 }) {
      let resp;
      try {
        resp = await fetchImpl(baseUrl + '/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: JSON.stringify({
            model,
            tools: [{ type: 'web_search' }],
            instructions: system,
            input: messages.map((m) => ({ role: m.role, content: m.content })),
            max_output_tokens: maxTokens
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'web search could not be reached');
      }
      if (!resp.ok) {
        const s = resp.status;
        throw new ProviderError(s === 429 ? 'busy' : s >= 500 ? 'unavailable' : 'config', `web search answered ${s}`, s);
      }
      const data = await resp.json().catch(() => null);
      let text = '';
      const citations = [];
      for (const item of Array.isArray(data?.output) ? data.output : []) {
        if (item?.type !== 'message') continue;
        for (const c of Array.isArray(item.content) ? item.content : []) {
          if (c?.type !== 'output_text' || typeof c.text !== 'string') continue;
          text += c.text;
          for (const a of Array.isArray(c.annotations) ? c.annotations : []) {
            if (a?.type === 'url_citation' && typeof a.url === 'string' && /^https?:\/\//.test(a.url) && !citations.some((x) => x.url === a.url)) {
              citations.push({ url: a.url, title: String(a.title || '').slice(0, 120) });
            }
          }
        }
      }
      const calls = (Array.isArray(data?.output) ? data.output : []).filter((i) => i?.type === 'web_search_call').length;
      return {
        text,
        citations: citations.slice(0, 6),
        searches: Math.max(1, calls),
        inputTokens: Number(data?.usage?.input_tokens) || 0,
        cachedTokens: Number(data?.usage?.input_tokens_details?.cached_tokens) || 0,
        outputTokens: Number(data?.usage?.output_tokens) || 0
      };
    }
  };
}

// Messages that need fresh information from the web.
const FRESH = /\b(latest|today|tonight|yesterday|this week|right now|currently|current|news|breaking|weather|forecast|score|who won|stock price|exchange rate|price of|how much is .* (now|today)|search (the )?(web|internet|online)|look (it )?up|google|20(2[6-9]|3\d))\b/i;
export const needsWeb = (text) => FRESH.test(String(text || ''));
