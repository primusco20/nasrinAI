import { ProviderError } from '../ai/provider.js';

// Web search through OpenAI's Responses API built-in tool
// (tools: [{ type: "web_search" }]), which returns an answer with url_citation
// annotations. The model is a setting (WEB_SEARCH_MODEL); check on OpenAI's
// web-search guide that your model supports the tool.
export function createWebSearch({ apiKey, model, fetchImpl = fetch, timeoutMs = 12_000, baseUrl = 'https://api.openai.com/v1' }) {
  return {
    model,
    async search({ system, messages, maxTokens = 1200, onText = null }) {
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
            max_output_tokens: maxTokens,
            ...(onText ? { stream: true } : {})
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
      const parseResult = (data) => {
        let text = '';
        const citations = [];
        for (const item of Array.isArray(data?.output) ? data.output : []) {
          if (item?.type !== 'message') continue;
          for (const c of Array.isArray(item.content) ? item.content : []) {
            if (c?.type !== 'output_text' || typeof c.text !== 'string') continue;
            text += c.text;
            for (const a of Array.isArray(c.annotations) ? c.annotations : []) {
              if (a?.type === 'url_citation' && typeof a.url === 'string') {
                let sourceUrl;
                try { sourceUrl = new URL(a.url); } catch { continue; }
                if (!['http:', 'https:'].includes(sourceUrl.protocol) || !sourceUrl.hostname || sourceUrl.username || sourceUrl.password) continue;
                const url = sourceUrl.href;
                if (!citations.some((x) => x.url === url)) citations.push({ url, title: String(a.title || '').replace(/[\r\n\t]/g, ' ').slice(0, 120) });
              }
              }
            }
          }
        }
        return { text, citations: citations.slice(0, 6) };
      };

      if (onText && resp.body) {
        let text = '';
        let citations = [];
        let calls = 0;
        let usage = null;
        let buffer = '';
        const decoder = new TextDecoder();
        const handle = (line) => {
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') return;
          let event; try { event = JSON.parse(payload); } catch { return; }
          const delta = event?.delta;
          if (event?.type === 'response.output_text.delta' && typeof delta === 'string') {
            text += delta; onText(delta);
          }
          if (event?.type === 'response.output_text.done' && typeof event?.text === 'string' && !text) {
            text = event.text; onText(event.text);
          }
          if (event?.type === 'response.web_search_call.completed') calls += 1;
          const response = event?.response;
          if (response?.usage) usage = response.usage;
          if (response?.output) {
            const parsed = parseResult(response);
            if (parsed.text && parsed.text !== text) text = parsed.text;
            citations = parsed.citations;
            calls = Math.max(calls, response.output.filter((i) => i?.type === 'web_search_call').length);
          }
        };
        try {
          for await (const chunk of resp.body) {
            buffer += decoder.decode(chunk, { stream: true });
            let i;
            while ((i = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, i).trim()); buffer = buffer.slice(i + 1); }
          }
          if (buffer.trim()) handle(buffer.trim());
        } catch (err) {
          throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'web search stream could not be read');
        }
        return {
          text,
          citations,
          searches: Math.max(1, calls),
          inputTokens: Number(usage?.input_tokens) || 0,
          cachedTokens: Number(usage?.input_tokens_details?.cached_tokens) || 0,
          outputTokens: Number(usage?.output_tokens) || Math.ceil(text.length / 4)
        };
      }

      const data = await resp.json().catch(() => null);
      const parsed = parseResult(data);
      const text = parsed.text;
      const citations = parsed.citations;
      const calls = (Array.isArray(data?.output) ? data.output : []).filter((i) => i?.type === 'web_search_call').length;
      return {
        text,
        citations,
        searches: Math.max(1, calls),
        inputTokens: Number(data?.usage?.input_tokens) || 0,
        cachedTokens: Number(data?.usage?.input_tokens_details?.cached_tokens) || 0,
        outputTokens: Number(data?.usage?.output_tokens) || 0
      };
    }
  };
}

// Messages that need fresh information from the web.
const FRESH = /\b(latest|today|tonight|yesterday|this week|right now|currently|current|news|breaking|weather|forecast|score|who won|stock price|exchange rate|price of|how much is .* (now|today)|search (the )?(web|internet|online)|look (it )?up|google|research|find sources|provide sources|cite sources|with citations|source links|browse the web|search online|on the internet|20(2[6-9]|3\d))\b/i;
export const needsWeb = (text) => FRESH.test(String(text || ''));
