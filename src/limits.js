import { HttpError } from './http/errors.js';
import { PLATFORM_TENANT_ID } from './tenants.js';

// Abuse and cost controls (audit findings H2 and M2). Every count lives in the
// shared database, so all server instances see the same numbers. If the counter
// cannot be read, the request is refused (fail closed), never waved through.

const HOUR = 3600;
const MANILA_OFFSET_MS = 8 * 3600 * 1000;   // UTC+8, no daylight saving

// Midnight in Manila, as a Date. Daily ceilings reset then.
export function manilaDayStart(nowMs = Date.now()) {
  const day = 24 * 3600 * 1000;
  return new Date(Math.floor((nowMs + MANILA_OFFSET_MS) / day) * day - MANILA_OFFSET_MS);
}

const tooMany = (retryAfter, message = 'Too many requests. Please wait a moment and try again.') =>
  new HttpError(429, 'rate_limited', message, { retryAfter });

export function createLimiter({ store, limits, now = () => Date.now() }) {
  async function hit(bucket, limit, message) {
    const r = await store.rateHit(bucket, HOUR, limit);
    if (!r.allowed) throw tooMany(r.retryAfter, message);
  }

  return {
    // Guest sessions are free to start, so they are limited per IP.
    async guestSession(ip) {
      await hit(`gs:ip:${ip || 'unknown'}`, limits.guestSessionsPerIpHour);
    },

    // Every chat message: per caller, plus per IP for people (not servers).
    async message(caller, ip) {
      const { type, id } = caller.actor;
      const perCaller = { guest: limits.guestMessagesHour, user: limits.userMessagesHour, service: limits.serviceMessagesHour }[type];
      await hit(`msg:${type}:${caller.tenantId}:${id}`, perCaller);
      if (type !== 'service') await hit(`msg:ip:${ip || 'unknown'}`, limits.ipMessagesHour);
    },

    // Reading replies aloud: per caller, plus per IP for people.
    async speech(caller, ip) {
      const { type, id } = caller.actor;
      const perCaller = { guest: limits.guestSpeechHour, user: limits.userSpeechHour, service: limits.userSpeechHour }[type];
      await hit(`sp:${type}:${caller.tenantId}:${id}`, perCaller, 'You have listened to a lot of replies this hour. Please try again later.');
      if (type !== 'service') await hit(`sp:ip:${ip || 'unknown'}`, limits.ipMessagesHour);
    },

    // Sign-in attempts (codes sent, codes tried, refreshes), by IP or by a hash of the address.
    async signIn(bucket, limit) {
      await hit(`si:${bucket}`, limit, 'Too many sign-in attempts. Please wait a while and try again.');
    },

    // Daily token budgets, checked before a model call is made.
    async budget(caller) {
      const since = manilaDayStart(now());
      const { type, id } = caller.actor;

      if (type === 'guest' && caller.tenantId === PLATFORM_TENANT_ID) {
        const used = await store.tokensSince({ since, tenantId: PLATFORM_TENANT_ID, actorType: 'guest' });
        if (used >= limits.guestDailyTokens) {
          throw new HttpError(429, 'guest_limit', 'Guest chat has reached its limit for today. Sign in to keep chatting.');
        }
      }
      if (type === 'user') {
        const used = await store.tokensSince({ since, tenantId: caller.tenantId, actorType: 'user', actorId: id });
        if (used >= limits.userDailyTokens) {
          throw new HttpError(429, 'daily_limit', 'You have reached today\'s limit. It resets at midnight (Manila time).');
        }
      }
      const tenantUsed = await store.tokensSince({ since, tenantId: caller.tenantId });
      if (tenantUsed >= caller.tenant.dailyTokenLimit) {
        throw new HttpError(429, 'tenant_limit', 'This service has reached its limit for today. Please try again tomorrow.');
      }
    }
  };
}

// One record per model call: who, which model, how many tokens, how long, and
// how it ended. No message text (audit finding M6). A failed write is logged
// loudly but does not take the reply away from the person who asked.
export function createUsageLog({ store, logger }) {
  return {
    async record(caller, e) {
      const event = {
        tenantId: caller.tenantId,
        actorType: caller.actor.type,
        actorId: caller.actor.id,
        provider: e.provider,
        model: e.model,
        inputTokens: Math.max(0, Math.round(e.inputTokens || 0)),
        outputTokens: Math.max(0, Math.round(e.outputTokens || 0)),
        latencyMs: Math.max(0, Math.round(e.latencyMs || 0)),
        outcome: e.outcome
      };
      try {
        await store.recordUsage(event);
      } catch (err) {
        logger.error('usage record not saved', { error: err.message, tenantId: event.tenantId, outcome: event.outcome });
      }
      logger.info('model call', event);
    }
  };
}
