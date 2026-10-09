import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, createUsageLog, manilaDayStart } from '../src/limits.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { createSupabaseStore } from '../src/store/supabase-store.js';
import { createPlans } from '../src/plans.js';
import { UpstreamError } from '../src/http/errors.js';
import { buildTestApp, serve, memoryLogger, testConfig, BIZ_TENANT } from './helpers.js';

const PLATFORM = '00000000-0000-0000-0000-000000000001';
const platformTenant = { kind: 'platform', dailyTokenLimit: 2_000_000 };
const guest = (id = 'g1', tenantId = PLATFORM, tenant = platformTenant) => ({ tenantId, tenant, actor: { type: 'guest', id }, scopes: ['chat'] });
const user = (id = 'u1') => ({ tenantId: PLATFORM, tenant: platformTenant, actor: { type: 'user', id }, scopes: ['chat'] });
const usage = (caller, tokens) => ({
  tenantId: caller.tenantId, actorType: caller.actor.type, actorId: caller.actor.id,
  provider: 'fake', model: 'm', inputTokens: tokens, outputTokens: 0, latencyMs: 1, outcome: 'ok'
});

test('the daily reset is midnight in Manila', () => {
  assert.equal(manilaDayStart(Date.parse('2026-10-05T16:30:00Z')).toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(manilaDayStart(Date.parse('2026-10-05T15:59:00Z')).toISOString(), '2026-10-04T16:00:00.000Z');
});

test('guest sessions are limited per IP, with Retry-After, across the real route', async () => {
  const { app } = buildTestApp({ env: { LIMIT_GUEST_SESSIONS_PER_IP_HOUR: '3' } });
  const srv = await serve(app);
  try {
    const start = (ip) => fetch(srv.url + '/v1/guest/sessions', { method: 'POST', headers: { 'X-Forwarded-For': ip } });
    for (let i = 0; i < 3; i++) assert.equal((await start('198.51.100.1')).status, 201);
    const blocked = await start('198.51.100.1');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.equal((await start('198.51.100.2')).status, 201, 'another IP is not affected');
    assert.equal((await start('6.6.6.6, 198.51.100.1')).status, 429, 'a spoofed left entry does not reset the count');
  } finally { await srv.close(); }
});

test('messages are limited per caller and per IP', async () => {
  const store = createMemoryStore();
  const limits = { ...testConfig().limits, guestMessagesHour: 2, ipMessagesHour: 3 };
  const limiter = createLimiter({ store, limits });

  await limiter.message(guest('a'), '1.1.1.1');
  await limiter.message(guest('a'), '1.1.1.1');
  await assert.rejects(limiter.message(guest('a'), '1.1.1.1'), { status: 429 });

  // the refused message stopped at the per-guest check, so the IP has counted 2;
  // a new guest on the same IP uses the 3rd, and the next one is refused
  await limiter.message(guest('b'), '1.1.1.1');
  await assert.rejects(limiter.message(guest('c'), '1.1.1.1'), { status: 429 });
  await limiter.message(guest('c'), '2.2.2.2');

  // servers are not counted per IP
  const service = { tenantId: BIZ_TENANT, tenant: { dailyTokenLimit: 1e6 }, actor: { type: 'service', id: 'k' }, scopes: ['chat'] };
  for (let i = 0; i < 5; i++) await limiter.message(service, '1.1.1.1');
});

test('daily budgets: platform guests, each user, and each business', async () => {
  const store = createMemoryStore();
  const limits = { ...testConfig().limits, guestDailyTokens: 1000, userDailyTokens: 500 };
  const limiter = createLimiter({ store, limits });

  await limiter.budget(guest('a'));
  await store.recordUsage(usage(guest('a'), 600));
  await store.recordUsage(usage(guest('b'), 400));
  await assert.rejects(limiter.budget(guest('c')), { code: 'guest_limit' });

  await limiter.budget(user('u1'));
  await store.recordUsage(usage(user('u1'), 500));
  await assert.rejects(limiter.budget(user('u1')), { code: 'daily_limit' });
  await limiter.budget(user('u2'));

  // a business's widget guests are bounded by that business's own limit
  const bizTenant = { kind: 'business', dailyTokenLimit: 100 };
  await limiter.budget(guest('w1', BIZ_TENANT, bizTenant));
  await store.recordUsage(usage(guest('w1', BIZ_TENANT, bizTenant), 100));
  await assert.rejects(limiter.budget(guest('w2', BIZ_TENANT, bizTenant)), { code: 'tenant_limit' });
});

test('Max and Ultra daily token allowances are isolated per signed-in user', async () => {
  const config = testConfig({ PLANS_ENABLED: 'true', USER_DAILY_TOKEN_LIMIT: '1000' });
  const store = createMemoryStore();
  const plans = createPlans({ store, config });
  const tenant = { ...platformTenant, dailyTokenLimit: 10_000_000 };
  const maxA = { ...user('max-a'), tenant };
  const maxB = { ...user('max-b'), tenant };
  const ultraA = { ...user('ultra-a'), tenant };
  const freeA = { ...user('free-a'), tenant };

  await store.addPlanPeriod({ tenantId: PLATFORM, userId: 'max-a', plan: 'max', days: 30, provider: 'test' });
  await store.addPlanPeriod({ tenantId: PLATFORM, userId: 'max-b', plan: 'max', days: 30, provider: 'test' });
  await store.addPlanPeriod({ tenantId: PLATFORM, userId: 'ultra-a', plan: 'ultra', days: 30, provider: 'test' });

  const limiter = createLimiter({ store, limits: config.limits, plans });
  await store.recordUsage(usage(maxA, 499_999));
  await limiter.budget(maxA);
  await store.recordUsage(usage(maxA, 1));
  await assert.rejects(limiter.budget(maxA), { code: 'daily_limit' });

  await limiter.budget(maxB);
  await store.recordUsage(usage(maxB, 500_000));
  await assert.rejects(limiter.budget(maxB), { code: 'daily_limit' });

  await limiter.budget(ultraA);
  await store.recordUsage(usage(ultraA, 2_000_000));
  await assert.rejects(limiter.budget(ultraA), { code: 'daily_limit' });

  await store.recordUsage(usage(freeA, 1_000));
  await assert.rejects(limiter.budget(freeA), { code: 'daily_limit' });
});

test('atomic reservations block concurrent overspend and settle idempotently', async () => {
  const store = createMemoryStore();
  const limits = { ...testConfig().limits, userDailyTokens: 1000, guestDailyTokens: 1000 };
  const tenant = { ...platformTenant, dailyTokenLimit: 5000 };
  const caller = { ...user('reserved-user'), tenant };
  const limiter = createLimiter({ store, limits });

  const outcomes = await Promise.allSettled([
    limiter.reserveTokens(caller, 600),
    limiter.reserveTokens(caller, 600)
  ]);
  const allowed = outcomes.filter((x) => x.status === 'fulfilled');
  const blocked = outcomes.filter((x) => x.status === 'rejected');
  assert.equal(allowed.length, 1);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason.code, 'daily_limit');

  const reservation = allowed[0].value;
  await limiter.settleTokens(reservation, 125);
  await limiter.settleTokens(reservation, 125);
  await store.recordUsage({ ...usage(caller, 125), reservationId: reservation.id });
  assert.equal(await store.tokensSince({ since: manilaDayStart(), tenantId: PLATFORM, actorType: 'user', actorId: 'reserved-user' }), 125);

  const second = await limiter.reserveTokens(caller, 800);
  assert.ok(second.id);
  await limiter.releaseTokens(second);
  assert.equal(await store.tokensSince({ since: manilaDayStart(), tenantId: PLATFORM, actorType: 'user', actorId: 'reserved-user' }), 125);
});

test('if the counters cannot be read, the request is refused (fail closed)', async () => {
  const broken = {
    rateHit: async () => { throw new UpstreamError('db down'); },
    tokensSince: async () => { throw new UpstreamError('db down'); }
  };
  const limiter = createLimiter({ store: broken, limits: testConfig().limits });
  await assert.rejects(limiter.guestSession('1.1.1.1'), UpstreamError);
  await assert.rejects(limiter.message(guest(), '1.1.1.1'), UpstreamError);
  await assert.rejects(limiter.budget(guest()), UpstreamError);
});

test('usage records hold numbers, not text; a failed write is logged, not thrown', async () => {
  const logger = memoryLogger();
  const store = createMemoryStore();
  const log = createUsageLog({ store, logger });
  await log.record(user(), { provider: 'fake', model: 'm', inputTokens: 12.4, outputTokens: 3, latencyMs: 40, outcome: 'ok', text: 'secret question' });
  assert.deepEqual(Object.keys(store.usage[0]).sort(),
    ['actorId', 'actorType', 'at', 'inputTokens', 'latencyMs', 'model', 'outcome', 'outputTokens', 'provider', 'tenantId',
      'task', 'level', 'costUsd', 'cachedTokens', 'escalated', 'cacheHit', 'reservationId'].sort());
  assert.equal(store.usage[0].inputTokens, 12);
  assert.ok(!JSON.stringify(logger.lines).includes('secret question'));

  const failing = createUsageLog({ store: { recordUsage: async () => { throw new UpstreamError('db down'); } }, logger });
  await failing.record(user(), { provider: 'fake', model: 'm', outcome: 'ok' });
  assert.ok(logger.lines.some((l) => l.level === 'error' && l.msg === 'usage record not saved'));
});

test('Supabase store: rate_hit and usage calls are shaped for the database functions', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body && JSON.parse(init.body), prefer: init.headers.Prefer });
    if (url.endsWith('rpc/rate_hit')) return new Response(JSON.stringify([{ allowed: false, used: 4, retry_after: 120 }]));
    if (url.endsWith('rpc/usage_tokens_since')) return new Response('1500');
    if (url.endsWith('rpc/reserve_daily_tokens')) return new Response(JSON.stringify([{ allowed: true, reason: null, reservation_id: '00000000-0000-0000-0000-000000000123', actor_used: 0, tenant_used: 0 }]));
    if (url.endsWith('rpc/settle_daily_token_reservation') || url.endsWith('rpc/release_daily_token_reservation')) return new Response('true');
    return new Response(null, { status: 201 });
  };
  const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl });

  assert.deepEqual(await store.rateHit('b', 3600, 3), { allowed: false, used: 4, retryAfter: 120 });
  assert.deepEqual(calls[0].body, { p_bucket: 'b', p_window_seconds: 3600, p_limit: 3 });

  assert.equal(await store.tokensSince({ since: new Date('2026-10-04T16:00:00Z'), tenantId: PLATFORM, actorType: 'guest' }), 1500);
  assert.deepEqual(calls[1].body, { p_since: '2026-10-04T16:00:00.000Z', p_tenant: PLATFORM, p_actor_type: 'guest', p_actor_id: null });

  await store.recordUsage({ tenantId: PLATFORM, actorType: 'user', actorId: 'u', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 2, latencyMs: 3, outcome: 'ok' });
  assert.equal(calls[2].url, 'https://p.supabase.co/rest/v1/usage_events');
  assert.equal(calls[2].prefer, 'return=minimal');
  assert.equal(calls[2].body.output_tokens, 2);

  const reservation = await store.reserveDailyTokens({
    reservationId: '00000000-0000-0000-0000-000000000123', tenantId: PLATFORM, actorType: 'user', actorId: 'u',
    reservedTokens: 400, actorLimit: 1000, guestLimit: 1000, tenantLimit: 2000
  });
  assert.deepEqual(reservation, { allowed: true, reason: null, reservationId: '00000000-0000-0000-0000-000000000123', actorUsed: 0, tenantUsed: 0 });
  assert.deepEqual(calls[3].body, {
    p_reservation_id: '00000000-0000-0000-0000-000000000123', p_tenant: PLATFORM, p_actor_type: 'user', p_actor_id: 'u',
    p_reserved_tokens: 400, p_actor_limit: 1000, p_guest_limit: 1000, p_tenant_limit: 2000
  });
  assert.equal(await store.settleDailyTokenReservation({ reservationId: reservation.reservationId, actualTokens: 125 }), true);
  assert.equal(await store.releaseDailyTokenReservation({ reservationId: reservation.reservationId }), true);
});
