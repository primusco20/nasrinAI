import { createHash } from 'node:crypto';
import { ProviderError } from './provider.js';
import { classify } from './classify.js';
import { priceOf, costOf, estimateTokens } from './pricing.js';
import { redactForProvider } from './redact.js';
import { HttpError } from '../http/errors.js';

// The cost-aware routing policy (Phase 4.1), between the chat and the router:
//
//   classify -> level within the tier's range -> privacy -> cheapest candidate
//   that fits the budget -> call -> validate -> (escalate once, bounded) -> done
//
// Candidates per level come from config (ROUTE_LEVEL_n), prices from
// config/model-prices.json, budgets from the budget controller. Nothing here
// names a model or a price.

const RETRYABLE = new Set(['unavailable', 'timeout', 'busy']);
const EFFORT_FACTOR = { none: 0, minimal: 0.25, low: 0.5, medium: 1, high: 2, xhigh: 3, max: 4 };

export function createPolicy({ config, provider, prices, budget, logger, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retryWaitMs = 1500 }) {
  const r = config.ai.routing;
  const cache = new Map();   // key -> { at, value }

  const capsOf = (spec) => (provider.capsOf ? provider.capsOf(spec.provider) : provider.capabilities());
  const priceFor = (spec) => priceOf(prices, spec.provider, spec.model, { freeTier: spec.provider === 'gemini' && r.geminiFreeTier });

  function estimate(spec, inputTokens, level, minOut = 0) {
    const out = Math.max(r.maxTokens[level], minOut) * (1 + (EFFORT_FACTOR[spec.effort] ?? 1));
    return costOf(priceFor(spec), { inputTokens, outputTokens: out });
  }

  // Why a candidate cannot be used for this request, or null if it can.
  function blocker(spec, { sensitive, attachments, inputTokens, level, left, minOut = 0, reqToolsCount = 0, tier, task }) {
    const c = capsOf(spec);
    if (!c) return 'not configured';
    // Anthropic is a coding specialist in NasrinAI: never route it for Quick/Pro,
    // never route it for non-coding work, and never allow a custom ROUTE_LEVEL_n
    // to bypass the Max/Ultra gate.
    if (spec.provider === 'anthropic' && (!['max', 'ultra'].includes(tier) || !['coding', 'debugging'].includes(task))) {
      return 'Claude is reserved for Max/Ultra coding';
    }
    if (sensitive && c.trainsOnData) return 'private data must not go to a service that trains on it';
    if (attachments.some((a) => a.kind === 'pdf') && c.pdf === false) return 'cannot read PDFs';
    if (attachments.some((a) => a.kind === 'image') && c.vision === false) return 'cannot see photos';
    if (attachments.length && c.pdf === false) return 'cannot read attachments';
    if (reqToolsCount > 0 && c.tools === false) return 'does not support tools';
    const cost = estimate(spec, inputTokens, level, minOut);
    if (cost === null) return 'no price on file';
    if (cost > 0 && budget.maxRequestUsd !== null && cost > budget.maxRequestUsd) return 'over the per-request limit';
    // Unknown spend: the cheapest level only (set in run), within the per-request cap.
    if (cost > 0 && !left.unknown && cost > left.usd) return `over the ${left.limitedBy} budget`;
    return null;
  }

  return {
    budgetLeft: () => budget.remaining(),
    spent: (usd) => budget.spend(usd),
    maxRequestUsd: budget.maxRequestUsd,

    // What the message needs and where it may go. tier: nasrinai | pro | max | ultra.
    plan({ tier, message, history = [], attachments = [] }) {
      const c = classify({ message, history, attachments });
      const [lo, hi] = r.tierRange[tier] || r.tierRange.nasrinai;
      const level = Math.min(hi, Math.max(lo, c.level));
      const text = [message, ...history.slice(-6).map((m) => m.content)].join('\n');
      const sensitive = attachments.length > 0 || redactForProvider(text) !== text;
      return { tier, task: c.task, wanted: c.level, level, floor: lo, ceiling: hi, reasons: c.reasons, sensitive,
        historyChars: r.historyChars[level], maxTokens: r.maxTokens[level] };
    },

    // Safe to reuse an earlier answer? Only a first, public, simple question.
    // Per business: an answer is never shared across businesses.
    cacheKey(plan, { history, attachments, message, tenantId = '' }) {
      if (!r.cacheMinutes || plan.sensitive || attachments.length || plan.level > 2 || history.length > 1) return null;
      const day = new Date(now()).toISOString().slice(0, 10);
      return createHash('sha256').update([tenantId, day, plan.level, String(message).trim().toLowerCase().replace(/\s+/g, ' ')].join('|')).digest('hex');
    },
    cached(key) {
      const hit = key && cache.get(key);
      if (!hit || now() - hit.at > r.cacheMinutes * 60_000) return null;
      return hit.value;
    },
    remember(key, value) {
      if (!key) return;
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), value });
    },

    // Runs the request. `req` is what the router takes, minus route/maxTokens.
    // `onFailure(entry)` is told about each attempt that did not produce the
    // answer (for usage records). Resolves { result, spec, level, escalated, costUsd }.
    async run(plan, req, { onFailure = async () => {} } = {}) {
      // `minTokens`: a request for a file or long document may use more reply tokens than its level allows.
      const { minTokens = 0, ...modelReq } = req;
      req = modelReq;
      const attachments = req.attachments || [];
      const inputTokens = estimateTokens(req.system) + req.messages.reduce((n, m) => n + estimateTokens(m.content || ''), 0)
        + (req.tools?.length ? estimateTokens(JSON.stringify(req.tools)) : 0);
      let left = await budget.remaining();
      // If spend cannot be read, stay on the cheapest level.
      let level = left.unknown ? plan.floor : plan.level;
      let escalations = 0;
      let retries = 0;
      const tried = new Set();
      let lastFailed = null;   // { spec, level } of a retryable failure, for one same-model retry
      let sameRetried = false;

      for (;;) {
        // The cheapest usable candidate at this level, else lower levels (downgrade).
        let spec = null; let at = level; const why = [];
        for (let l = level; l >= plan.floor && !spec; l--) {
          const candidates = [];
          // Coding gets a dedicated Claude lane only on Max/Ultra. It is tried
          // before the general model pool at the classified level, so a coding
          // request does not accidentally land on a generic cheap model.
          if ((plan.task === 'coding' || plan.task === 'debugging') && l === level) {
            const codingSpec = plan.tier === 'ultra' && l >= 4
              ? (r.coding?.ultraDeep || r.coding?.ultra)
              : r.coding?.[plan.tier];
            if (codingSpec) candidates.push(codingSpec);
          }
          candidates.push(...r.levels[l]);
          for (const s of candidates) {
            const k = `${s.provider}:${s.model}:${s.effort}`;
            if (tried.has(k)) continue;
            const b = blocker(s, {
              sensitive: plan.sensitive, attachments, inputTokens, level: l, left, minOut: minTokens,
              reqToolsCount: Array.isArray(req.tools) ? req.tools.length : 0, tier: plan.tier, task: plan.task
            });
            if (b) { why.push(`${s.provider}:${s.model} (${b})`); continue; }
            spec = s; at = l; break;
          }
        }
        // No other model left after a brief outage: the same one once more,
        // after a short wait (bounded by MAX_RETRIES).
        if (!spec && lastFailed && !sameRetried && retries <= r.maxRetries) {
          sameRetried = true;
          spec = lastFailed.spec; at = lastFailed.level;
          logger.info('retrying the same model once', { provider: spec.provider, waitMs: retryWaitMs });
          await sleep(retryWaitMs);
        }
        if (!spec) {
          logger.warn('no model can take this request', { level, reasons: why });
          if (why.length && why.every((w) => /cannot (read|see)/.test(w))) {
            throw new HttpError(400, 'attachment_unsupported', 'NasrinAI cannot read that kind of file right now. Try another file, or remove it.');
          }
          throw new HttpError(503, 'budget_reached',
            why.some((w) => /budget|limit|unknown/.test(w))
              ? 'NasrinAI has reached its spending limit for now. Please try again later.'
              : 'NasrinAI cannot answer this right now. Please try again in a moment.', { retryAfter: 600 });
        }
        if (at < level) logger.info('downgraded to fit the budget', { from: level, to: at });

        const started = now();
        try {
          const result = await provider.generate({ ...req, route: spec, maxTokens: Math.max(r.maxTokens[at], minTokens) });
          const cachedTokens = Number(result.cachedTokens) || 0;
          const costUsd = costOf(priceFor(spec), { inputTokens: result.inputTokens, cachedTokens, outputTokens: result.outputTokens }) ?? 0;
          budget.spend(costUsd);
          const text = String(result.text || '').trim();
          const asksTools = Array.isArray(result.toolCalls) && result.toolCalls.length > 0;
          const valid = asksTools || (text.length > 0 && !(result.finishReason === 'length' && text.length < 40));
          if (valid) return { result, spec, level: at, escalated: escalations > 0, costUsd, cachedTokens };
          await onFailure({ spec, level: at, result, costUsd, latencyMs: now() - started, outcome: 'rejected_output', escalated: escalations > 0 });
          // Escalate one level when the answer was empty or cut off.
          if (escalations >= r.maxEscalations || at >= plan.ceiling || left.unknown) return { result, spec, level: at, escalated: escalations > 0, costUsd, cachedTokens };
          escalations += 1;
          level = at + 1;
          left = await budget.remaining();
          logger.info('escalating', { from: at, to: level, reason: text ? 'cut off' : 'empty answer' });
        } catch (err) {
          if (!(err instanceof ProviderError) || !RETRYABLE.has(err.kind) || retries >= r.maxRetries) throw Object.assign(err, { level: at });
          // Failover: same level, next candidate (privacy and budget rules still apply).
          retries += 1;
          tried.add(`${spec.provider}:${spec.model}:${spec.effort}`);
          lastFailed = { spec, level: at };
          await onFailure({ spec, level: at, error: err, latencyMs: now() - started, outcome: err.kind === 'timeout' ? 'timeout' : 'provider_error' });
          logger.warn('model failed, trying the next one', { kind: err.kind, provider: spec.provider });
          level = at;
        }
      }
    }
  };
}
