import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget, createProviderSpendHooks } from '../src/ai/budget.js';
import { createRouter } from '../src/ai/router.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { loadConfig } from '../src/config.js';
import { loadPrices } from '../src/ai/pricing.js';

const quiet = { info() {}, warn() {}, error() {} };
const PLATFORM = '00000000-0000-0000-0000-000000000001';
const caller = { tenantId: PLATFORM, actor: { type: 'user', id: 'spend-test-user' } };
const env = {
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'sk-test-' + 'x'.repeat(32),
  DAILY_BUDGET_USD: '0.05',
  WEEKLY_BUDGET_USD: '0.10',
  MONTHLY_BUDGET_USD: '0.20',
  MAX_REQUEST_COST_USD: '0.05',
  MAX_REQUEST_COST_PRO_USD: '0.05',
  IMAGE_DAILY_BUDGET_USD: '0.10',
  IMAGE_WEEKLY_BUDGET_USD: '0.20',
  IMAGE_MONTHLY_BUDGET_USD: '0.30'
};

test('global spend reservations serialize concurrent requests and reconcile actual cost', async () => {
  const config = loadConfig(env);
  const store = createMemoryStore();
  const budget = createBudget({ store, config, logger: quiet });
  const results = await Promise.allSettled([
    budget.reserveSpend({ caller, amountUsd: 0.04, maxRequestUsd: 0.05 }),
    budget.reserveSpend({ caller, amountUsd: 0.04, maxRequestUsd: 0.05 })
  ]);
  const granted = results.filter((r) => r.status === 'fulfilled');
  const denied = results.filter((r) => r.status === 'rejected');
  assert.equal(granted.length, 1);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason.code, 'budget_reached');

  const reservation = granted[0].value;
  assert.equal(await budget.settleSpend(reservation, 0.01), 0.01);
  assert.equal(await store.costSince(new Date(0)), 0.01);

  await store.recordUsage({ tenantId: caller.tenantId, actorType: 'user', actorId: caller.actor.id,
    provider: 'openai', model: 'gpt-5-mini', outcome: 'ok', task: 'chat', costUsd: 0.01,
    spendReservationId: reservation.id });
  assert.equal(await store.costSince(new Date(0)), 0.01, 'linked telemetry must not double-count ledger spend');

  const next = await budget.reserveSpend({ caller, amountUsd: 0.04, maxRequestUsd: 0.05 });
  assert.ok(next.id);
  await budget.releaseSpend(next);
  assert.equal(await store.costSince(new Date(0)), 0.01, 'released holds do not count as spend');
});

test('image and reasoning reservations use separate ceilings', async () => {
  const config = loadConfig(env);
  const store = createMemoryStore();
  const reasoning = createBudget({ store, config, logger: quiet });
  const images = createBudget({ store, config, logger: quiet, kind: 'image' });
  const chatHold = await reasoning.reserveSpend({ caller, amountUsd: 0.04, maxRequestUsd: 0.05 });
  const imageHold = await images.reserveSpend({ caller, amountUsd: 0.08 });
  await reasoning.releaseSpend(chatHold);
  await images.releaseSpend(imageHold);
});

test('global spend reservation fails closed when the database ledger is unavailable', async () => {
  const config = loadConfig(env);
  const store = createMemoryStore();
  store.reserveGlobalSpend = async () => { throw new Error('database unavailable'); };
  const budget = createBudget({ store, config, logger: quiet });
  await assert.rejects(budget.reserveSpend({ caller, amountUsd: 0.01, maxRequestUsd: 0.05 }), { code: 'budget_reached' });
});

test('router reserves and settles spend for each real provider attempt', async () => {
  const config = loadConfig({ ...env, DAILY_BUDGET_USD: '1', WEEKLY_BUDGET_USD: '2', MONTHLY_BUDGET_USD: '4' });
  const store = createMemoryStore();
  const budget = createBudget({ store, config, logger: quiet });
  const prices = loadPrices();
  const raw = createFakeProvider({ models: ['gpt-5-mini'], reply: () => 'A short, complete answer.' });
  const router = createRouter({ providers: { openai: raw }, config, logger: quiet });
  const hooks = createProviderSpendHooks({ budget, config, prices, caller, tier: 'pro' });
  const result = await router.generate({
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'hello' }],
    route: { provider: 'openai', model: 'gpt-5-mini', effort: null },
    maxTokens: 100,
    spendHooks: hooks,
    spendTier: 'pro'
  });
  assert.ok(result.spendReservationId);
  assert.ok(result.costUsd >= 0);
  assert.ok((await store.costSince(new Date(0))) >= 0);
});
