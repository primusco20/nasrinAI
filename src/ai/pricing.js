// Imported (not read from disk) so Vercel bundles it with the function.
import BASE_PRICES from '../../config/model-prices.json' with { type: 'json' };

// Prices come from config/model-prices.json (USD per 1M tokens), optionally
// overridden by the MODEL_PRICES_JSON setting with the same shape. Routing and
// budget code only ask this module; no price is written anywhere else.

export function loadPrices(overrideJson = '') {
  const base = BASE_PRICES;
  const table = {};
  const add = (src) => {
    for (const [provider, models] of Object.entries(src || {})) {
      if (provider.startsWith('_') || !models || typeof models !== 'object') continue;
      table[provider] = { ...(table[provider] || {}) };
      for (const [model, p] of Object.entries(models)) {
        if (!p || typeof p !== 'object') continue;
        const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
        const input = n(p.input); const output = n(p.output);
        if (input === null || output === null) continue;
        table[provider][model] = { input, cachedInput: n(p.cached_input) ?? input, output, freeTier: p.free_tier === true };
      }
    }
  };
  add(base);
  if (overrideJson) add(JSON.parse(overrideJson));
  return table;
}

// Price for one provider/model, or null when unknown (unknown = never assumed free).
export function priceOf(table, provider, model, { freeTier = false } = {}) {
  const p = table[provider]?.[model] || table[provider]?.['*'] || null;
  if (!p) return null;
  if (freeTier && p.freeTier) return { input: 0, cachedInput: 0, output: 0, free: true };
  return p;
}

// USD for a call. Tokens are counts, not millions.
export function costOf(price, { inputTokens = 0, cachedTokens = 0, outputTokens = 0 }) {
  if (!price) return null;
  const fresh = Math.max(0, inputTokens - cachedTokens);
  return (fresh * price.input + cachedTokens * price.cachedInput + outputTokens * price.output) / 1e6;
}

// A rough token count for text (about 4 characters per token).
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);
