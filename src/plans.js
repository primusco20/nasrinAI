import { HttpError } from './http/errors.js';

// Plans for signed-in users: Free, Max and Ultra. A plan unlocks tiers:
//   Free   Quick, Pro
//   Max    + Max
//   Ultra  + Max, Ultra
// Plans are paid periods (see db/migrations/002_plans.sql). Business keys are
// not limited by these plans. With PLANS_ENABLED=false everything is open, as
// before plans existed.

export const PLANS = Object.freeze([
  { id: 'free', name: 'Free', rank: 0 },
  { id: 'max', name: 'Max', rank: 1 },
  { id: 'ultra', name: 'Ultra', rank: 2 }
]);
export const rank = (id) => (PLANS.find((p) => p.id === id) || PLANS[0]).rank;
export const planName = (id) => (PLANS.find((p) => p.id === id) || PLANS[0]).name;

// The plan a tier needs, or null for tiers everyone signed in can use.
export const TIER_NEEDS = Object.freeze({ max: 'max', ultra: 'ultra' });

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
    async planFor(caller) { return (await current(caller)).plan; },
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
          tiers: p.id === 'free' ? ['Quick', 'Pro'] : p.id === 'max' ? ['Quick', 'Pro', 'Max'] : ['Quick', 'Pro', 'Max', 'Ultra'],
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
