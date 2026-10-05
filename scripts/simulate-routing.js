// Cost simulation for smart routing (no network, no model calls).
//   node scripts/simulate-routing.js            uses .env-like settings from the environment
// Sends a synthetic workload through the real classifier, level ranges and
// price file, with assumed token sizes, and prints the distribution and an
// estimated cost. Token sizes are assumptions; check them against
// usage_events once real traffic exists.
import { loadConfig } from '../src/config.js';
import { classify } from '../src/ai/classify.js';
import { loadPrices, priceOf, costOf } from '../src/ai/pricing.js';

const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-sim', ...process.env };
const config = loadConfig(env);
const r = config.ai.routing;
const prices = loadPrices(r.pricesJson);

const WORKLOAD = [
  // [count, example message, assumed input tokens incl. system + history]
  [1000, 'Can you reply to a customer asking where their order is?', 700],
  [100, 'Write a javascript function that groups orders by day and sums totals', 1500],
  [25, 'My python script fails with TypeError: NoneType when reading the CSV, debug it', 3000],
  [5, 'Plan an end-to-end architecture redesign of the entire codebase for multi-tenant POS', 6000]
];
const EFFORT_FACTOR = { none: 0, minimal: 0.25, low: 0.5, medium: 1, high: 2, xhigh: 3, max: 4 };

for (const tier of ['nasrinai', 'pro', 'ultra']) {
  const [lo, hi] = r.tierRange[tier];
  const byLevel = {}; let total = 0; let requests = 0; let inTok = 0; let outTok = 0;
  for (const [count, message, input] of WORKLOAD) {
    let level = Math.min(hi, Math.max(lo, classify({ message }).level));
    // Pick the first candidate at the level with a price that fits the per-request cap.
    let spec; let cost;
    for (let l = level; l >= lo && !spec; l--) {
      for (const s of r.levels[l]) {
        const p = priceOf(prices, s.provider, s.model, { freeTier: s.provider === 'gemini' && r.geminiFreeTier });
        // Assume the reply uses 60% of the allowance, plus reasoning tokens by effort.
        const out = Math.round(r.maxTokens[l] * 0.6 * (1 + (EFFORT_FACTOR[s.effort] ?? 1)));
        const c = costOf(p, { inputTokens: input, outputTokens: out });
        if (c === null || (r.budget.maxRequestUsd !== null && c > r.budget.maxRequestUsd)) continue;
        spec = s; cost = c; level = l; outTok += out * count; break;
      }
    }
    inTok += input * count; requests += count; total += cost * count;
    const k = `L${level} ${spec.provider}:${spec.model}`;
    byLevel[k] = (byLevel[k] || 0) + count;
  }
  console.log(`\nTier "${tier}" (levels ${lo}-${hi}), ${requests} requests`);
  for (const [k, n] of Object.entries(byLevel)) console.log(`  ${k.padEnd(40)} ${String(n).padStart(5)}  ${(100 * n / requests).toFixed(1)}%`);
  console.log(`  tokens in ${inTok.toLocaleString()} / out ${outTok.toLocaleString()}`);
  console.log(`  estimated cost $${total.toFixed(4)}  ($${(total / requests).toFixed(6)} per request)`);
}
console.log(`\nBudget: daily $${r.budget.dailyUsd}, weekly $${r.budget.weeklyUsd}, monthly $${r.budget.monthlyUsd}, per request $${r.budget.maxRequestUsd}`);
