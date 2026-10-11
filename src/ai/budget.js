import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { manilaDayStart } from '../limits.js';
import { costOf, estimateTokens, priceOf } from './pricing.js';

// The cached balance is a routing hint only. PostgreSQL reservations are the
// enforcement point shared by every serverless instance. Unknown prices and an
// unavailable reservation ledger fail closed before a paid provider call.
export function createBudget({ store, config, logger, kind = 'reasoning', now = () => Date.now(), cacheMs = 30_000 }) {
  const b = kind === 'image' ? config.images.budget : config.ai.routing.budget;
  const spentSince = kind === 'image'
    ? (since) => store.imageCostSince(since)
    : async (since) => (await store.costSince(since)) - (await store.imageCostSince(since).catch(() => 0));
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
        const spent = await spentSince(since);
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

  async function reserveSpend({ caller, amountUsd, maxRequestUsd = null }) {
    if (!caller?.tenantId || !caller?.actor?.type || !caller?.actor?.id
        || !Number.isFinite(amountUsd) || amountUsd < 0.000001
        || !store.reserveGlobalSpend) {
      throw new HttpError(503, 'budget_reached', 'NasrinAI cannot verify its spending limit right now. Please try again later.', { retryAfter: 600 });
    }
    const reservationId = randomUUID();
    let result;
    try {
      result = await store.reserveGlobalSpend({
        reservationId, kind, tenantId: caller.tenantId, actorType: caller.actor.type, actorId: caller.actor.id,
        reservedUsd: Math.round(amountUsd * 1e6) / 1e6,
        dailyLimit: b.dailyUsd, weeklyLimit: b.weeklyUsd, monthlyLimit: b.monthlyUsd, maxRequestUsd
      });
    } catch (err) {
      logger.error('global USD reservation failed', { kind, error: err.message });
      throw new HttpError(503, 'budget_reached', 'NasrinAI cannot verify its spending limit right now. Please try again later.', { retryAfter: 600 });
    }
    if (!result?.allowed || result.reservationId !== reservationId) {
      throw new HttpError(503, 'budget_reached', 'NasrinAI has reached its spending limit for now. Please try again later.', { retryAfter: 600 });
    }
    if (cache.value && !cache.value.unknown && Number.isFinite(cache.value.usd)) {
      cache.value = { ...cache.value, usd: Math.max(0, cache.value.usd - amountUsd) };
    }
    return { id: reservationId, kind, reservedUsd: Math.round(amountUsd * 1e6) / 1e6 };
  }

  async function settleSpend(reservation, actualUsd) {
    if (!reservation?.id || !Number.isFinite(actualUsd) || actualUsd < 0 || !store.settleGlobalSpendReservation) {
      throw new HttpError(503, 'budget_reached', 'NasrinAI could not reconcile provider spending. Please try again later.', { retryAfter: 600 });
    }
    const actual = Math.round(actualUsd * 1e6) / 1e6;
    let ok;
    try { ok = await store.settleGlobalSpendReservation({ reservationId: reservation.id, actualUsd: actual }); }
    catch (err) {
      logger.error('global USD settlement failed; reservation remains held', { kind, error: err.message });
      throw new HttpError(503, 'budget_reached', 'NasrinAI could not reconcile provider spending. Please try again later.', { retryAfter: 600 });
    }
    if (!ok) throw new HttpError(503, 'budget_reached', 'NasrinAI could not reconcile provider spending. Please try again later.', { retryAfter: 600 });
    if (cache.value && !cache.value.unknown && Number.isFinite(cache.value.usd)) {
      cache.value = { ...cache.value, usd: Math.max(0, cache.value.usd + reservation.reservedUsd - actual) };
    }
    return actual;
  }

  async function releaseSpend(reservation) {
    if (!reservation?.id || !store.releaseGlobalSpendReservation) {
      throw new HttpError(503, 'budget_reached', 'NasrinAI could not release its spending reservation safely. Please try again later.', { retryAfter: 600 });
    }
    let ok;
    try { ok = await store.releaseGlobalSpendReservation({ reservationId: reservation.id }); }
    catch (err) {
      logger.error('global USD release failed; reservation remains held', { kind, error: err.message });
      throw new HttpError(503, 'budget_reached', 'NasrinAI could not release its spending reservation safely. Please try again later.', { retryAfter: 600 });
    }
    if (!ok) throw new HttpError(503, 'budget_reached', 'NasrinAI could not release its spending reservation safely. Please try again later.', { retryAfter: 600 });
    if (cache.value && !cache.value.unknown && Number.isFinite(cache.value.usd)) {
      cache.value = { ...cache.value, usd: Math.max(0, cache.value.usd + reservation.reservedUsd) };
    }
  }

  return {
    remaining,
    maxRequestUsd: b.maxRequestUsd ?? null,
    reserveSpend,
    settleSpend,
    releaseSpend,
    // Retained for separately metered tools while they are migrated to
    // reservations. This only updates the local routing hint, never the ledger.
    spend(usd) {
      if (cache.value && Number.isFinite(usd) && cache.value.usd !== Infinity) {
        cache.value = { ...cache.value, usd: Math.max(0, cache.value.usd - usd) };
      }
    }
  };
}

// Injected into the router for each authenticated request. The router invokes
// this separately for each actual provider attempt, including failover.
export function createProviderSpendHooks({ budget, config, prices, caller, tier }) {
  if (!budget || !caller) return null;
  const maxRequestUsd = config.ai.routing.budget.maxRequestUsdByTier?.[tier] ?? budget.maxRequestUsd;
  const estimateInput = (request) => {
    const text = estimateTokens(request.system)
      + (request.messages || []).reduce((n, m) => n + estimateTokens(m.content || ''), 0)
      + (request.tools?.length ? estimateTokens(JSON.stringify(request.tools)) : 0)
      + (request.attachments || []).reduce((n, a) => n + (a.kind === 'image' ? 8192 : a.kind === 'pdf' ? 16000 : 4000), 0);
    // Tokenization varies by language and payload. Add headroom to the estimate;
    // actual usage is reconciled after the provider returns.
    return Math.ceil(text * 1.35);
  };
  return {
    async reserve({ provider, model, request }) {
      if (provider === 'fake' && !config.isProduction) return null;
      const price = priceOf(prices, provider, model, { freeTier: provider === 'gemini' && config.ai.routing.geminiFreeTier });
      if (!price) throw new HttpError(503, 'budget_reached', 'NasrinAI cannot safely price this model call, so it was blocked.', { retryAfter: 600 });
      const inputTokens = estimateInput(request);
      const outputTokens = Math.max(1, Math.round(Number(request.maxTokens) || config.ai.maxReplyTokens));
      const estimate = costOf(price, { inputTokens, outputTokens });
      if (estimate === null || !Number.isFinite(estimate)) {
        throw new HttpError(503, 'budget_reached', 'NasrinAI cannot safely price this model call, so it was blocked.', { retryAfter: 600 });
      }
      if (estimate <= 0) return null; // configured local/no-cost model
      if (maxRequestUsd !== null && estimate > maxRequestUsd) {
        throw new HttpError(503, 'budget_reached', 'This request exceeds the configured per-request spending limit.', { retryAfter: 600 });
      }
      const amountUsd = Math.min(maxRequestUsd ?? Infinity, Math.max(estimate * 1.35, estimate + 0.000001));
      const reservation = await budget.reserveSpend({ caller, amountUsd, maxRequestUsd });
      return { ...reservation, provider, model, price };
    },
    async settle(reservation, result) {
      if (!reservation) return { costUsd: 0, spendReservationId: null };
      const hasUsage = Number.isFinite(result?.inputTokens) && Number.isFinite(result?.outputTokens);
      const estimatedActual = hasUsage
        ? costOf(reservation.price, { inputTokens: result.inputTokens, cachedTokens: result.cachedTokens || 0, outputTokens: result.outputTokens })
        : null;
      const actualUsd = Number.isFinite(estimatedActual) ? estimatedActual : reservation.reservedUsd;
      const costUsd = await budget.settleSpend(reservation, actualUsd);
      return { costUsd, spendReservationId: reservation.id };
    },
    async release(reservation) {
      if (reservation) await budget.releaseSpend(reservation);
    }
  };
}
