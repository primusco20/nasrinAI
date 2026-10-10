import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeProvider } from '../src/ai/fake.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { loadConfig } from '../src/config.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN, SECRET_KEY } from './helpers.js';

const PLATFORM = '00000000-0000-0000-0000-000000000001';
const MODELS = ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5'];

async function app({ plan = null, env = {} } = {}) {
  const built = buildTestApp({ provider: createFakeProvider({ models: MODELS }), env });
  if (plan) await built.store.addPlanPeriod({ tenantId: PLATFORM, userId: 'user-1', plan, days: 30, provider: 'manual' });
  const srv = await serve(built.app);
  const models = async (cred) => (await (await fetch(srv.url + '/v1/models', { headers: bearer(cred) })).json()).models
    .map((m) => (m.locked ? `${m.id}:${m.needs}${m.plan ? ':' + m.plan : ''}` : m.id));
  const chat = (cred, model) => postJson(srv.url + '/v1/chat', { message: 'hi', model }, bearer(cred));
  return { ...built, ...srv, models, chat };
}

test('a signed-in user on Quick sees Pro, Max and Ultra locked behind their plans', async () => {
  const a = await app();
  try {
    assert.deepEqual(await a.models(USER_TOKEN), ['nasrinai', 'pro:plan:pro', 'max:plan:max', 'ultra:plan:ultra']);
    const pro = await a.chat(USER_TOKEN, 'pro');
    assert.equal(pro.status, 403);
    assert.deepEqual((await pro.json()).error, { code: 'plan_required', message: 'Pro comes with the Pro plan.' });
    assert.equal((await a.chat(USER_TOKEN, 'max')).status, 403);
  } finally { await a.close(); }
});

test('the Max plan opens Max; Ultra opens both', async () => {
  const max = await app({ plan: 'max' });
  try {
    assert.deepEqual(await max.models(USER_TOKEN), ['nasrinai', 'pro', 'max', 'ultra:plan:ultra']);
    assert.equal((await max.chat(USER_TOKEN, 'max')).status, 200);
    assert.equal((await max.chat(USER_TOKEN, 'ultra')).status, 403);
  } finally { await max.close(); }
  const ultra = await app({ plan: 'ultra' });
  try {
    assert.deepEqual(await ultra.models(USER_TOKEN), ['nasrinai', 'pro', 'max', 'ultra']);
    assert.equal((await ultra.chat(USER_TOKEN, 'ultra')).status, 200);
  } finally { await ultra.close(); }
});

test('guests are asked to sign in; business keys are not limited by plans', async () => {
  const a = await app();
  try {
    const g = (await (await fetch(a.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    assert.deepEqual(await a.models(g), ['nasrinai', 'pro:sign_in:pro', 'max:sign_in:max', 'ultra:sign_in:ultra']);
    assert.equal((await a.chat(SECRET_KEY, 'ultra')).status, 200);
  } finally { await a.close(); }
});

test('PLANS_ENABLED=false opens every tier to signed-in users, as before', async () => {
  const a = await app({ env: { PLANS_ENABLED: 'false' } });
  try {
    assert.deepEqual(await a.models(USER_TOKEN), ['nasrinai', 'pro', 'max', 'ultra']);
    const plans = await (await fetch(a.url + '/v1/plans', { headers: bearer(USER_TOKEN) })).json();
    assert.equal(plans.enabled, false);
  } finally { await a.close(); }
});

test('/v1/plans: annual price is exposed separately when configured', async () => {
  const a = await app({ plan: 'max', env: { PLAN_MAX_PRICE: '299', PLAN_MAX_ANNUAL_PRICE: '2990' } });
  try {
    const p = await (await fetch(a.url + '/v1/plans', { headers: bearer(USER_TOKEN) })).json();
    const max = p.plans.find((x) => x.id === 'max');
    assert.deepEqual(max.annual_price, { amount: 2990, currency: 'PHP', days: 365 });
    assert.equal(max.annual_available, false, 'test app has no payment provider');
  } finally { await a.close(); }
});

test('/v1/plans: plans, prices (or coming soon) and the current plan', async () => {
  const a = await app({ plan: 'max', env: { PLAN_MAX_PRICE: '299' } });
  try {
    const p = await (await fetch(a.url + '/v1/plans', { headers: bearer(USER_TOKEN) })).json();
    assert.equal(p.current, 'max');
    assert.match(p.ends_at, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(p.plans.map((x) => [x.id, x.price && x.price.amount, x.available]), [['free', null, false], ['pro', null, false], ['max', 299, false], ['ultra', null, false]]);
    assert.deepEqual(p.plans[3].tiers, ['Quick', 'Pro', 'Max', 'Ultra']);
    assert.equal((await fetch(a.url + '/v1/plans')).status, 401);
  } finally { await a.close(); }
});

test('config: bad prices and switches are reported, not fatal', () => {
  const c = loadConfig({ PLAN_MAX_PRICE: '299.50', PLAN_ULTRA_PRICE: '999', PLANS_ENABLED: 'maybe' });
  assert.deepEqual(c.plans.prices, { max: null, ultra: 999 });
  assert.equal(c.plans.enabled, false);
  assert.equal(c.warnings.length, 2);
  assert.equal(loadConfig({}).plans.enabled, true);
});

test('memory store: a payment counts once, and paying early adds days after the current period', async () => {
  let t = Date.parse('2026-10-05T00:00:00Z');
  const store = createMemoryStore({ now: () => t });
  const base = { tenantId: PLATFORM, userId: 'u', plan: 'max', days: 30, provider: 'paymongo' };
  assert.ok(await store.addPlanPeriod({ ...base, ref: 'cs_1' }));
  assert.equal(await store.addPlanPeriod({ ...base, ref: 'cs_1' }), null);
  await store.addPlanPeriod({ ...base, ref: 'cs_2' });
  assert.deepEqual((await store.activePlans({ tenantId: PLATFORM, userId: 'u' })).map((p) => p.endsAt), ['2026-11-04T00:00:00.000Z']);
  t = Date.parse('2026-11-10T00:00:00Z');
  assert.deepEqual((await store.activePlans({ tenantId: PLATFORM, userId: 'u' })).map((p) => p.endsAt), ['2026-12-04T00:00:00.000Z']);
});

test('if plans cannot be read, the user is Free and chat still works', async () => {
  const built = buildTestApp({ provider: createFakeProvider({ models: MODELS }) });
  built.store.activePlans = async () => { throw new Error('relation "plan_periods" does not exist'); };
  const srv = await serve(built.app);
  try {
    const list = await (await fetch(srv.url + '/v1/models', { headers: bearer(USER_TOKEN) })).json();
    assert.deepEqual(list.models.filter((m) => !m.locked).map((m) => m.id), ['nasrinai']);
    assert.equal((await postJson(srv.url + '/v1/chat', { message: 'hi' }, bearer(USER_TOKEN))).status, 200);
  } finally { await srv.close(); }
});
