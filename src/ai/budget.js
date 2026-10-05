import { manilaDayStart } from '../limits.js';

// The budget controller: how much (estimated) USD may still be spent now.
// Reads the spend from usage_events (cost_usd) for the day, the week (last 7
// days) and the month (last 30 days), at most every 30 seconds. If the spend
// cannot be read, it reports `unknown` and the policy only allows the cheapest
// level, so a database problem never turns into unlimited spending.
export function createBudget({ store, config, logger, now = () => Date.now(), cacheMs = 30_000 }) {
  const b = config.ai.routing.budget;
  let cache = { at: -Infinity, value: null };

  async function remaining() {
    if (now() - cache.at < cacheMs && cache.value) return cache.value;
    const t = now();
    const periods = [
      ['daily', b.dailyUsd, manilaDayStart(t)],
      ['weekly', b.weeklyUsd, new Date(t - 7 * 86400_000)],
      ['monthly', b.monthlyUsd, new Date(t - 30 * 86400_000)]
    ].filter(([, limit]) => limit !== null);
    let value;
    try {
      let left = Infinity; let limitedBy = null;
      for (const [name, limit, since] of periods) {
        const spent = await store.costSince(since);
        if (limit - spent < left) { left = limit - spent; limitedBy = name; }
      }
      value = { usd: Math.max(0, left), limitedBy, unknown: false };
    } catch (err) {
      logger.warn('spend could not be read; only the cheapest level is allowed', { error: err.message });
      value = { usd: 0, limitedBy: 'unknown', unknown: true };
    }
    cache = { at: now(), value };
    return value;
  }

  return {
    remaining,
    maxRequestUsd: b.maxRequestUsd,
    // After a call, count its cost right away (without waiting for the cache).
    spend(usd) { if (cache.value && Number.isFinite(usd) && cache.value.usd !== Infinity) cache.value = { ...cache.value, usd: Math.max(0, cache.value.usd - usd) }; }
  };
}
