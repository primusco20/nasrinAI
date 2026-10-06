import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, serve, bearer, USER_TOKEN, SECRET_KEY } from './helpers.js';
import { createSettings, readPrefs } from '../src/settings.js';
import { createMemory, memoryTools } from '../src/knowledge/memory.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { PLATFORM_TENANT_ID } from '../src/tenants.js';

const OTHER_TOKEN = 'other.user.token';
const users = async (t) => (t === USER_TOKEN ? { id: 'user-1' } : t === OTHER_TOKEN ? { id: 'user-2' } : null);
const get = async (url, token) => fetch(url, { headers: token ? bearer(token) : {} });
const guestToken = async (url) => (await (await fetch(url + '/v1/guest/sessions', { method: 'POST' })).json()).token;

test('usage: the caller’s own numbers from the counters the limits use; nobody else’s', async () => {
  const built = buildTestApp({ verifyUser: users, env: { USER_DAILY_TOKEN_LIMIT: '1000', LIMIT_USER_MESSAGES_HOUR: '40' } });
  const { url, close } = await serve(built.app);
  try {
    const rec = (actorId, inputTokens) => built.store.recordUsage({ tenantId: PLATFORM_TENANT_ID, actorType: 'user', actorId, provider: 'fake', model: 'm', inputTokens, outputTokens: 0, outcome: 'ok' });
    await rec('user-1', 300);
    await rec('user-1', 50);
    await rec('user-2', 900);

    const mine = await (await get(url + '/v1/usage', USER_TOKEN)).json();
    assert.deepEqual(mine.chat, { used: 350, limit: 1000, unit: 'tokens', period: 'day' });
    assert.equal(mine.hourly.messages, 40);
    assert.ok(Date.parse(mine.resets_at) > Date.now(), 'resets at the next Manila midnight');
    assert.equal(new Date(mine.resets_at).getUTCHours(), 16, 'midnight in Manila is 16:00 UTC');

    const theirs = await (await get(url + '/v1/usage', OTHER_TOKEN)).json();
    assert.equal(theirs.chat.used, 900);

    await rec('user-1', 5000);
    assert.equal((await (await get(url + '/v1/usage', USER_TOKEN)).json()).chat.used, 1000, 'never shows more than the limit');

    // A user id in the request changes nothing: the caller comes from the token.
    const spoof = await (await get(url + '/v1/usage?user_id=user-2&actor_id=user-2', USER_TOKEN)).json();
    assert.equal(spoof.chat.used, 1000);

    const guest = await (await get(url + '/v1/usage', await guestToken(url))).json();
    assert.equal(guest.chat, null, 'guests share one pool; no personal number is invented');
    assert.ok(guest.hourly.messages > 0);

    assert.equal((await get(url + '/v1/usage')).status, 401);
    assert.equal((await get(url + '/v1/usage', SECRET_KEY)).status, 403);
  } finally { await close(); }
});

test('billing: own plan and payments only, amounts in pesos, no payment details', async () => {
  const built = buildTestApp({ verifyUser: users, env: { PLAN_MAX_PRICE: '199' } });
  const { url, close } = await serve(built.app);
  try {
    await built.store.addPlanPeriod({ tenantId: PLATFORM_TENANT_ID, userId: 'user-1', plan: 'max', days: 30, provider: 'paymongo', ref: 'cs_secret_ref_1', amount: 19900, currency: 'PHP' });
    await built.store.addPlanPeriod({ tenantId: PLATFORM_TENANT_ID, userId: 'user-2', plan: 'ultra', days: 30, provider: 'paymongo', ref: 'cs_secret_ref_2', amount: 49900, currency: 'PHP' });

    const mine = await (await get(url + '/v1/billing', USER_TOKEN)).json();
    assert.equal(mine.plan.id, 'max');
    assert.equal(mine.payments.length, 1);
    assert.deepEqual([mine.payments[0].plan, mine.payments[0].amount, mine.payments[0].currency, mine.payments[0].via], ['max', 199, 'PHP', 'PayMongo']);
    assert.equal(JSON.stringify(mine).includes('cs_secret_ref'), false, 'payment references are not sent to the page');

    const usage = await (await get(url + '/v1/usage', USER_TOKEN)).json();
    assert.equal(usage.plan.id, mine.plan.id, 'Usage and Billing agree on the plan');
    assert.equal(usage.plan.ends_at, mine.plan.ends_at);

    assert.equal((await (await get(url + '/v1/billing', OTHER_TOKEN)).json()).plan.id, 'ultra');
    assert.equal((await get(url + '/v1/billing', await guestToken(url))).status, 403);
    assert.equal((await get(url + '/v1/billing')).status, 401);
  } finally { await close(); }
});

test('privacy: memory off is enforced on the server; settings are saved with the person’s own token', async () => {
  // Saving: only known keys, sent with the caller's own token.
  const calls = [];
  const fetchImpl = async (u, init) => {
    calls.push({ u, init });
    return Response.json({ user_metadata: JSON.parse(init.body).data });
  };
  const forgotten = [];
  const settings = createSettings({ url: 'https://p.supabase.co', anonKey: 'anon', fetchImpl, forgetToken: (t) => forgotten.push(t) });
  const caller = { tenantId: PLATFORM_TENANT_ID, actor: { type: 'user', id: 'user-1' }, prefs: { memory: true } };
  assert.deepEqual(await settings.update(caller, 'tok.en.one', { memory: false, user_id: 'user-2', admin: true }), { memory: false, notices: { features: true, tips: true }, seen: [] });
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok.en.one');
  assert.deepEqual(JSON.parse(calls[0].init.body), { data: { nasrin_prefs: { memory: false, notices: { features: true, tips: true }, seen: [] } } });
  assert.deepEqual(forgotten, ['tok.en.one']);
  await assert.rejects(settings.update(caller, 't', { memory: 'off' }), /on or off/);
  await assert.rejects(settings.update(caller, 't', {}), /Nothing to change/);
  await assert.rejects(settings.update({ ...caller, actor: { type: 'guest', id: 'g' } }, 't', { memory: false }), /Sign in/);
  assert.deepEqual(readPrefs({ nasrin_prefs: { memory: 'no' } }), { memory: null, notices: { features: true, tips: true }, seen: [] }, 'bad stored values read as not chosen (off)');
  assert.deepEqual(readPrefs(undefined), { memory: null, notices: { features: true, tips: true }, seen: [] }, 'memory is opt-in')

  // Memory off: no notes added to chats, and the remember tool is neither offered nor run.
  const store = createMemoryStore();
  await store.addMemory({ tenantId: PLATFORM_TENANT_ID, userId: 'user-1', text: 'likes calamansi' });
  const memory = createMemory({ store, logger: { warn() {} } });
  const on = { ...caller, prefs: { memory: true } };
  const off = { ...caller, prefs: { memory: false } };
  assert.match(await memory.context(on, 'calamansi'), /likes calamansi/);
  assert.equal(await memory.context(off, 'calamansi'), null);
  const reg = createToolRegistry({ tools: memoryTools({ store }) });
  assert.equal(reg.specsFor(on).length, 1);
  assert.equal(reg.specsFor(off).length, 0);
  await assert.rejects(reg.run(off, 'remember', { note: 'x' }, { confirmed: true }), (e) => e.code === 'not_allowed');
  assert.equal((await store.listMemories({ tenantId: PLATFORM_TENANT_ID, userId: 'user-1' })).length, 1, 'nothing was saved');
});

test('settings routes: signed-in only, unavailable without sign-in service', async () => {
  const settings = createSettings({ url: 'https://p.supabase.co', anonKey: 'anon', fetchImpl: async (u, init) => Response.json({ user_metadata: JSON.parse(init.body).data }) });
  const built = buildTestApp({ verifyUser: async (t) => (t === USER_TOKEN ? { id: 'user-1', prefs: { memory: false } } : null), settings });
  const { url, close } = await serve(built.app);
  try {
    assert.deepEqual(await (await get(url + '/v1/settings', USER_TOKEN)).json(), { prefs: { memory: false, notices: { features: true, tips: true }, seen: [] } });
    const put = await fetch(url + '/v1/settings', { method: 'PUT', headers: { ...bearer(USER_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify({ memory: true }) });
    assert.deepEqual(await put.json(), { prefs: { memory: true, notices: { features: true, tips: true }, seen: [] } });
    assert.equal((await get(url + '/v1/settings', await guestToken(url))).status, 403);
    assert.equal((await get(url + '/v1/settings')).status, 401);
  } finally { await close(); }
  const plain = buildTestApp({ verifyUser: users });
  const s2 = await serve(plain.app);
  try { assert.equal((await get(s2.url + '/v1/settings', USER_TOKEN)).status, 503); } finally { await s2.close(); }
});
