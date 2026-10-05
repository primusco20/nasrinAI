import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPayMongo, verifySignature } from '../src/payments/paymongo.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { loadConfig } from '../src/config.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const PLATFORM = '00000000-0000-0000-0000-000000000001';
const SK = 'sk_test_' + 'a'.repeat(24);
const WH = 'whsk_' + 'b'.repeat(24);
const ENV = { PAYMONGO_SECRET_KEY: SK, PAYMONGO_WEBHOOK_SECRET: WH, SITE_URL: 'https://nasrinai.site', PLAN_MAX_PRICE: '299' };

const sign = (raw, t = 1759650000, mode = 'te') => `t=${t},${mode}=${createHmac('sha256', WH).update(`${t}.${raw}`).digest('hex')}`;

// A pretend PayMongo API. `paid` decides what a session lookup reports.
function fakePayMongo({ paid = 29900, metadata = null } = {}) {
  const calls = [];
  let created = null;
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method, headers: init.headers, body });
    if (url.endsWith('/checkout_sessions') && init.method === 'POST') {
      created = body.data.attributes;
      return Response.json({ data: { id: 'cs_abc123', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_abc123' } } });
    }
    if (url.includes('/checkout_sessions/cs_')) {
      return Response.json({ data: { id: 'cs_abc123', attributes: {
        livemode: false,
        metadata: metadata || created?.metadata || {},
        payments: paid ? [{ attributes: { status: 'paid', currency: 'PHP', amount: paid } }] : []
      } } });
    }
    return Response.json({}, { status: 404 });
  };
  const cfg = loadConfig(ENV).paymongo;
  return { payments: createPayMongo({ ...cfg, fetchImpl }), calls };
}

async function setup(opts = {}) {
  const pm = fakePayMongo(opts);
  const built = buildTestApp({ provider: createFakeProvider({ models: ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5'] }), env: ENV, payments: pm.payments });
  const srv = await serve(built.app);
  const hook = (event, signature) => {
    const raw = JSON.stringify(event);
    return fetch(srv.url + '/v1/payments/paymongo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': signature ?? sign(raw) }, body: raw });
  };
  return { ...built, ...srv, ...pm, hook };
}

const paidEvent = (id = 'cs_abc123', livemode = false) => ({
  data: { id: 'evt_1', type: 'event', attributes: { type: 'checkout_session.payment.paid', livemode, data: { id, type: 'checkout_session', attributes: {} } } }
});

test('signature: HMAC-SHA256 of "t.body" with the webhook secret, test or live part', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(verifySignature(raw, sign(raw), WH, false), true);
  assert.equal(verifySignature(raw, sign(raw, 1, 'li'), WH, true), true);
  assert.equal(verifySignature(raw, sign(raw), WH, true), false, 'a test signature is not a live one');
  assert.equal(verifySignature(Buffer.from('{"a":2}'), sign(raw), WH, false), false, 'changed body');
  assert.equal(verifySignature(raw, 't=1,te=zz', WH, false), false);
  assert.equal(verifySignature(raw, undefined, WH, false), false);
});

test('checkout: signed-in users only, priced plans only, keys stay on the server', async () => {
  const a = await setup();
  try {
    const r = await postJson(a.url + '/v1/plans/checkout', { plan: 'max' }, bearer(USER_TOKEN));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { checkout_url: 'https://checkout.paymongo.com/cs_abc123' });
    const sent = a.calls[0];
    assert.equal(sent.url, 'https://api.paymongo.com/v1/checkout_sessions');
    assert.equal(sent.headers.Authorization, 'Basic ' + Buffer.from(SK + ':').toString('base64'));
    const attrs = sent.body.data.attributes;
    assert.deepEqual(attrs.line_items.map((l) => [l.amount, l.currency, l.quantity]), [[29900, 'PHP', 1]]);
    assert.deepEqual(attrs.payment_method_types, ['gcash', 'paymaya', 'card']);
    assert.deepEqual(attrs.metadata, { tenant_id: PLATFORM, user_id: 'user-1', plan: 'max', days: '30', amount: '29900' });
    assert.equal(attrs.success_url, 'https://nasrinai.site/?plan=paid');

    assert.equal((await postJson(a.url + '/v1/plans/checkout', { plan: 'ultra' }, bearer(USER_TOKEN))).status, 400, 'Ultra has no price yet');
    assert.equal((await postJson(a.url + '/v1/plans/checkout', { plan: 'gold' }, bearer(USER_TOKEN))).status, 400);
    const g = (await (await fetch(a.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    assert.equal((await postJson(a.url + '/v1/plans/checkout', { plan: 'max' }, bearer(g))).status, 403);

    const plans = await (await fetch(a.url + '/v1/plans', { headers: bearer(USER_TOKEN) })).json();
    assert.deepEqual(plans.plans.map((p) => [p.id, p.available]), [['free', false], ['max', true], ['ultra', false]]);
  } finally { await a.close(); }
});

test('webhook: a verified, fully paid session gives the plan, once', async () => {
  const a = await setup();
  try {
    await postJson(a.url + '/v1/plans/checkout', { plan: 'max' }, bearer(USER_TOKEN));
    const r = await a.hook(paidEvent());
    assert.deepEqual(await r.json(), { recorded: true });
    await a.hook(paidEvent());   // PayMongo may send it again
    assert.equal(a.store.planPeriods.length, 1);
    assert.deepEqual(a.store.planPeriods.map((p) => [p.userId, p.plan, p.provider, p.ref, p.amount]), [['user-1', 'max', 'paymongo', 'cs_abc123', 29900]]);
    const models = (await (await fetch(a.url + '/v1/models', { headers: bearer(USER_TOKEN) })).json()).models;
    assert.equal(models.find((m) => m.id === 'max').locked, undefined, 'Max is open now');
  } finally { await a.close(); }
});

test('webhook: bad signatures are refused; other modes and events are ignored', async () => {
  const a = await setup();
  try {
    await postJson(a.url + '/v1/plans/checkout', { plan: 'max' }, bearer(USER_TOKEN));
    assert.equal((await a.hook(paidEvent(), 't=1,te=' + '0'.repeat(64))).status, 401);
    assert.equal((await a.hook(paidEvent(), '')).status, 401);
    const live = paidEvent('cs_abc123', true);
    assert.deepEqual(await (await a.hook(live, sign(JSON.stringify(live), 1, 'li'))).json(), { ignored: true }, 'test key ignores live events');
    const other = paidEvent(); other.data.attributes.type = 'payment.failed';
    assert.deepEqual(await (await a.hook(other)).json(), { ignored: true });
    assert.equal(a.store.planPeriods.length, 0);
  } finally { await a.close(); }
});

test('webhook: underpaid or tampered sessions are not recorded', async () => {
  for (const opts of [{ paid: 100 }, { paid: 0 }, { metadata: { tenant_id: PLATFORM, user_id: 'user-1', plan: 'gold', days: '30', amount: '29900' } },
    { metadata: { tenant_id: '11111111-1111-4111-8111-111111111111', user_id: 'user-1', plan: 'max', days: '30', amount: '29900' } }]) {
    const a = await setup(opts);
    try {
      await postJson(a.url + '/v1/plans/checkout', { plan: 'max' }, bearer(USER_TOKEN));
      assert.deepEqual(await (await a.hook(paidEvent())).json(), { recorded: false }, JSON.stringify(opts));
      assert.equal(a.store.planPeriods.length, 0);
    } finally { await a.close(); }
  }
});

test('config: PayMongo turns on only when complete; mistakes are reported', () => {
  assert.ok(loadConfig(ENV).paymongo);
  for (const [env, problem] of [
    [{ ...ENV, PAYMONGO_SECRET_KEY: 'pk_test_' + 'a'.repeat(24) }, /secret key/],
    [{ ...ENV, PAYMONGO_WEBHOOK_SECRET: '' }, /WEBHOOK_SECRET/],
    [{ ...ENV, SITE_URL: '' }, /SITE_URL/],
    [{ ...ENV, PAYMONGO_METHODS: 'gcash,bitcoin' }, /PAYMONGO_METHODS/]
  ]) {
    const c = loadConfig(env);
    assert.equal(c.paymongo, null, JSON.stringify(env));
    assert.ok(c.warnings.some((w) => problem.test(w)), c.warnings.join(' | '));
  }
  assert.equal(loadConfig({}).paymongo, null);
});
