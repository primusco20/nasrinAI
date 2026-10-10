import { randomUUID } from 'node:crypto';
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

// Resolve the daily token allowance from the authenticated account's active plan.
// A missing/failed plan lookup never grants a paid allowance.
export async function userDailyTokenLimit(caller, { limits, plans = null }) {
  if (caller.actor.type !== 'user' || !plans) return limits.userDailyTokens;
  try {
    const current = await plans.current(caller, { fresh: true });
    if (!current || current.open) return limits.userDailyTokens;
    if (current.plan === 'max' && Number.isSafeInteger(limits.maxDailyTokens)) return limits.maxDailyTokens;
    if (current.plan === 'ultra' && Number.isSafeInteger(limits.ultraDailyTokens)) return limits.ultraDailyTokens;
  } catch { /* fail back to the lower Free/default ceiling */ }
  return limits.userDailyTokens;
}

// Monday 00:00 in Philippine time. Paid token allowances are weekly.
export function manilaWeekStart(nowMs = Date.now()) {
  const dayStart = manilaDayStart(nowMs);
  const day = new Date(dayStart).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 3600 * 1000);
}

// Paid plans get their configured weekly allowance. Quick has no per-user
// token ceiling; platform/tenant and hourly abuse controls still apply.
export async function userWeeklyTokenLimit(caller, { limits, plans = null }) {
  if (caller.actor.type !== 'user' || !plans) return 0;
  try {
    const current = await plans.current(caller, { fresh: true });
    if (!current || current.open) return 0;
    const allowance = ({ pro: limits.proWeeklyTokens, max: limits.maxWeeklyTokens, ultra: limits.ultraWeeklyTokens })[current.plan];
    if (!Number.isSafeInteger(allowance) || allowance <= 0) return 0;
    const since = manilaWeekStart(now());
    const used = await caller.store?.tokensSince?.({ since, tenantId: caller.tenantId, actorType: 'user', actorId: caller.actor.id });
    if (Number.isFinite(used) && used >= allowance) return 0;
    return allowance;
  } catch { /* fail closed to Quick rather than granting a paid allowance */ }
  return 0;
}

export function createLimiter({ store, limits, plans = null, now = () => Date.now() }) {
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

    // Web pages read and web searches: per caller, people only.
    async web(caller) {
      const { type, id } = caller.actor;
      const limit = type === 'guest' ? limits.guestWebHour : type === 'user' ? limits.userWebHour : limits.serviceMessagesHour;
      const r = await store.rateHit(`web:${type}:${caller.tenantId}:${id}`, HOUR, limit);
      return r.allowed;
    },

    // Project and task changes: per person.
    async projects(caller) {
      await hit(`prj:${caller.tenantId}:${caller.actor.id}`, limits.userProjectsHour, 'You have changed your projects a lot this hour. Please try again later.');
    },

    // Adding to the Library: per person.
    async library(caller) {
      await hit(`lib:${caller.tenantId}:${caller.actor.id}`, limits.userLibraryHour, 'You have added a lot to your Library this hour. Please try again later.');
    },

    // Sign-in attempts (codes sent, codes tried, refreshes), by IP or by a hash of the address.
    async signIn(bucket, limit) {
      await hit(`si:${bucket}`, limit, 'Too many sign-in attempts. Please wait a while and try again.');
    },

    // Reserve tokens transactionally before a provider call. Reservations are
    // shared by every server instance and count against both actor and tenant caps.
    async reserveTokens(caller, reservedTokens) {
      if (!Number.isSafeInteger(reservedTokens) || reservedTokens < 1 || reservedTokens > 10_000_000) {
        throw new HttpError(400, 'invalid_token_reservation', 'The token reservation is invalid.');
      }
      const { type, id } = caller.actor;
      const actorLimit = type === 'user' ? await userWeeklyTokenLimit(caller, { limits, plans }) : 0;
      const reservationId = randomUUID();
      const result = await store.reserveDailyTokens({
        reservationId,
        tenantId: caller.tenantId,
        actorType: type,
        actorId: id,
        reservedTokens,
        actorLimit,
        guestLimit: limits.guestDailyTokens,
        tenantLimit: caller.tenant.dailyTokenLimit
      });
      if (!result?.allowed) {
        if (result?.reason === 'guest_limit') {
          throw new HttpError(429, 'guest_limit', 'Guest chat has reached its limit for today. Sign in to keep chatting.');
        }
        if (result?.reason === 'daily_limit') {
          throw new HttpError(429, 'daily_limit', 'You have reached today\'s limit. It resets at midnight (Manila time).');
        }
        if (result?.reason === 'tenant_limit') {
          throw new HttpError(429, 'tenant_limit', 'This service has reached its limit for today. Please try again tomorrow.');
        }
        throw new HttpError(503, 'quota_unavailable', 'NasrinAI could not reserve token capacity safely. Please try again.');
      }
      if (result.reservationId !== reservationId) {
        throw new HttpError(503, 'quota_unavailable', 'NasrinAI could not reserve token capacity safely. Please try again.');
      }
      return { id: reservationId, reservedTokens };
    },

    // Unknown provider failures should settle conservatively at the reserved
    // amount. Call releaseTokens only when the provider was never invoked.
    async settleTokens(reservation, actualTokens) {
      if (!reservation?.id || !Number.isSafeInteger(actualTokens) || actualTokens < 0) {
        throw new HttpError(503, 'quota_settlement_failed', 'Token usage could not be reconciled safely.');
      }
      const ok = await store.settleDailyTokenReservation({ reservationId: reservation.id, actualTokens });
      if (!ok) throw new HttpError(503, 'quota_settlement_failed', 'Token usage could not be reconciled safely.');
    },

    async releaseTokens(reservation) {
      if (!reservation?.id) return;
      const ok = await store.releaseDailyTokenReservation({ reservationId: reservation.id });
      if (!ok) throw new HttpError(503, 'quota_release_failed', 'Token capacity could not be released safely.');
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
        const limit = await userDailyTokenLimit(caller, { limits, plans });
        if (used >= limit) {
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
        reservationId: e.reservationId || null,
        provider: e.provider,
        model: e.model,
        inputTokens: Math.max(0, Math.round(e.inputTokens || 0)),
        outputTokens: Math.max(0, Math.round(e.outputTokens || 0)),
        latencyMs: Math.max(0, Math.round(e.latencyMs || 0)),
        outcome: e.outcome,
        // Routing telemetry (migration 003). Metadata only, never message text.
        task: e.task || null,
        level: Number.isInteger(e.level) ? e.level : null,
        costUsd: Number.isFinite(e.costUsd) ? Math.max(0, e.costUsd) : null,
        cachedTokens: Number.isFinite(e.cachedTokens) ? Math.max(0, Math.round(e.cachedTokens)) : null,
        escalated: e.escalated === true,
        cacheHit: e.cacheHit === true
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
