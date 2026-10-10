import { HttpError } from './http/errors.js';

// Plans for signed-in users: Quick (free), Pro (subscription), Max and Ultra.
// Each paid plan adds a weekly token allowance and its corresponding model tier.
// Plans are paid periods (see db/migrations/002_plans.sql). Business keys are
// not limited by these plans. With PLANS_ENABLED=false everything is open, as
// before plans existed.

export const PLANS = Object.freeze([
  { id: 'free', name: 'Quick', rank: 0 },
  { id: 'pro', name: 'Pro', rank: 1 },
  { id: 'max', name: 'Max', rank: 2 },
  { id: 'ultra', name: 'Ultra', rank: 3 }
]);
export const rank = (id) => (PLANS.find((p) => p.id === id) || PLANS[0]).rank;
export const planName = (id) => (PLANS.find((p) => p.id === id) || PLANS[0]).name;

// The plan a tier needs, or null for tiers everyone signed in can use.
export const TIER_NEEDS = Object.freeze({ pro: 'pro', max: 'max', ultra: 'ultra' });

export function createPlans({ store, config, logger = null, now = () => Date.now(), cacheMs = 60_000 }) {
  const cache = new Map();   // userId -> { until, value }

  async function current(caller, { fresh = false } = {}) {
    if (!config.plans.enabled || caller.actor.type === 'service') return { plan: 'ultra', endsAt: null, open: true };
    if (caller.actor.type !== 'user') return { plan: 'free', endsAt: null };
    const key = caller.tenantId + ':' + caller.actor.id;
    const hit = cache.get(key);
    if (!fresh && hit && hit.until > now()) return hit.value;
    // If plans cannot be read (for example migration 002 not run yet), the
    // user is treated as Free: paid tiers stay closed, everything else works.
    let periods;
    try {
      periods = await store.activePlans({ tenantId: caller.tenantId, userId: caller.actor.id });
    } catch (err) {
      if (logger) logger.warn('plans unavailable, treating user as Free', { error: err.message });
      return { plan: 'free', endsAt: null };
    }
    let best = { plan: 'free', endsAt: null };
    for (const p of periods) {
      if (rank(p.plan) > rank(best.plan) || (p.plan === best.plan && p.endsAt > best.endsAt)) best = { plan: p.plan, endsAt: p.endsAt };
    }
    if (cache.size > 5000) cache.clear();
    cache.set(key, { until: now() + cacheMs, value: best });
    return best;
  }

  return {
    current,
    async planFor(caller) {
      const active = await current(caller);
      if (active.open || caller.actor.type !== 'user' || active.plan === 'free') return active.plan;
      const allowance = ({ pro: config.limits.proWeeklyTokens, max: config.limits.maxWeeklyTokens, ultra: config.limits.ultraWeeklyTokens })[active.plan];
      if (!Number.isSafeInteger(allowance) || allowance <= 0) return active.plan;
      const nowMs = now();
      const dayStart = new Date(Math.floor((nowMs + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000);
      const weekday = new Date(nowMs + 8 * 3600_000).getUTCDay();
      const weekStart = new Date(dayStart.getTime() - ((weekday + 6) % 7) * 86400_000);
      try {
        const used = await store.tokensSince({ since: weekStart, tenantId: caller.tenantId, actorType: 'user', actorId: caller.actor.id });
        return used >= allowance ? 'free' : active.plan;
      } catch (err) {
        if (logger) logger.warn('weekly plan usage unavailable, routing to Quick', { error: err.message });
        return 'free';
      }
    },
    forget(caller) { cache.delete(caller.tenantId + ':' + caller.actor.id); },

    // What /v1/plans shows: the plans, their price (or null: not for sale yet),
    // and the caller's plan.
    async describe(caller, { purchasable = false } = {}) {
      const mine = await current(caller);
      const list = PLANS.map((p) => {
        const price = p.id === 'free' ? null : config.plans.prices[p.id];
        return {
          id: p.id,
          name: p.name,
          tiers: p.id === 'free' ? ['Quick'] : p.id === 'pro' ? ['Quick', 'Pro'] : p.id === 'max' ? ['Quick', 'Pro', 'Max'] : ['Quick', 'Pro', 'Max', 'Ultra'],
          price: price ? { amount: price, currency: 'PHP', days: config.plans.periodDays } : null,
          annual_price: p.id === 'free' ? null : config.plans.annualPrices[p.id]
            ? { amount: config.plans.annualPrices[p.id], currency: 'PHP', days: 365 } : null,
          available: p.id !== 'free' && Boolean(price) && purchasable,
          annual_available: p.id !== 'free' && Boolean(config.plans.annualPrices[p.id]) && purchasable
        };
      });
      return {
        enabled: config.plans.enabled,
        current: mine.open ? null : mine.plan,
        ends_at: mine.endsAt,
        plans: list
      };
    },

    needsPlanError(tierName, plan) {
      return new HttpError(403, 'plan_required', `${tierName} comes with the ${planName(plan)} plan.`);
    }
  };
}
