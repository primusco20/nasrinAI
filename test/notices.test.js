import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, serve, bearer, USER_TOKEN, SECRET_KEY } from './helpers.js';
import { loadNotices, createNotices, MAX_SHOWN } from '../src/notices.js';
import { createSettings, SEEN_MAX } from '../src/settings.js';
import { PLATFORM_TENANT_ID } from '../src/tenants.js';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const base = { type: 'info', when: 'open', audience: 'all', title: 'Hello', body: 'Something new.' };
const n = (id, extra = {}) => ({ ...base, id, ...extra });
const quiet = { warn() {} };
const user = (prefs = {}) => ({ tenantId: PLATFORM_TENANT_ID, actor: { type: 'user', id: 'user-1' }, prefs });

test('the notices list is checked: bad entries are left out, never shown', () => {
  const warned = [];
  const list = loadNotices([
    n('ok-one'),
    n('ok-one'),                                        // duplicate id
    n('Bad Id'),                                        // id format
    n('plan-ends-x'),                                   // reserved for the server's own notices
    n('bad-type', { type: 'popup' }),
    n('bad-when', { when: 'always' }),
    n('bad-audience', { audience: 'admins' }),
    n('no-title', { title: '' }),
    n('long-body', { body: 'x'.repeat(241) }),
    n('control', { title: 'Hi\u0007' }),
    n('bad-date', { until: 'soon' }),
    n('link-action', { action: { label: 'Open', target: 'https://evil.example' } }),
    n('bad-requires', { requires: 'admin' }),
    null, 'text',
    n('good-action', { action: { label: 'See plans', target: 'plans' }, from: '2026-10-01', until: '2026-11-01' })
  ], { warn: (m, d) => warned.push(d.id) });
  assert.deepEqual(list.map((x) => x.id), ['ok-one', 'good-action']);
  assert.equal(warned.length, 14);
  assert.deepEqual(list[1].action, { label: 'See plans', target: 'plans' });
  assert.ok(loadNotices().length >= 1, 'the shipped list is valid');
  assert.equal(loadNotices().length, loadNotices(undefined, { warn() { throw new Error('shipped notice is invalid'); } }).length);
});

test('general notices: dates, moment, audience, Professional AI, order and cap', () => {
  const list = loadNotices([
    n('past', { until: '2026-10-09' }),
    n('future', { from: '2026-10-11' }),
    n('window', { from: '2026-10-01', until: '2026-10-11' }),
    n('newchat', { when: 'new_chat' }),
    n('both', { when: 'both', type: 'success' }),
    n('users-only', { audience: 'user' }),
    n('guests-only', { audience: 'guest', type: 'feature' }),
    n('pro', { requires: 'professional', type: 'security' })
  ], quiet);
  const on = createNotices({ list, config: { professional: { enabled: true } }, now: () => NOW });
  const open = on.general('open');
  assert.equal(open.length, MAX_SHOWN);
  assert.deepEqual(open.map((x) => x.id), ['pro', 'guests-only', 'window'], 'security first, then feature, then info');
  assert.deepEqual(Object.keys(open[0]).sort(), ['action', 'body', 'id', 'title', 'type'], 'only what the page shows');
  assert.deepEqual(on.general('new_chat').map((x) => x.id), ['newchat', 'both']);
  const off = createNotices({ list, config: { professional: { enabled: false } }, now: () => NOW });
  assert.equal(off.general('open').some((x) => x.id === 'pro'), false, 'not shown while Professional AI is switched off');
});

test('a person’s notices: closed ones and turned-off kinds hidden; security always shown; plan ending soon', async () => {
  const list = loadNotices([
    n('tip', { when: 'both' }),
    n('feat', { type: 'feature' }),
    n('alert', { type: 'security' }),
    n('guests-only', { audience: 'guest' })
  ], quiet);
  let plan = { plan: 'max', endsAt: new Date(NOW + 2 * 86_400_000).toISOString() };
  const plans = { current: async () => plan };
  const svc = createNotices({ list, plans, config: { plans: { enabled: true } }, now: () => NOW });

  const all = await svc.forUser(user(), 'open');
  assert.deepEqual(all.map((x) => x.id), ['alert', 'plan-ends-2026-10-12', 'feat'], 'cap of three, most important first');
  const planNotice = all[1];
  assert.equal(planNotice.type, 'warning');
  assert.match(planNotice.title, /Max plan ends soon/);
  assert.equal(planNotice.body, 'It ends on October 12. After that, your account is on Free.');
  assert.deepEqual(planNotice.action, { label: 'See plans', target: 'plans' });

  const quietPrefs = await svc.forUser(user({ notices: { features: false, tips: false }, seen: ['plan-ends-2026-10-12'] }), 'open');
  assert.deepEqual(quietPrefs.map((x) => x.id), ['alert'], 'security notices cannot be turned off');
  assert.deepEqual((await svc.forUser(user({ seen: ['alert'] }), 'new_chat')).map((x) => x.id), ['tip'], 'no plan notice on a new chat');

  plan = { plan: 'max', endsAt: new Date(NOW + 5 * 86_400_000).toISOString() };
  assert.equal((await svc.forUser(user(), 'open')).some((x) => x.id.startsWith('plan-')), false, 'not yet');
  plan = { plan: 'free', endsAt: null };
  assert.equal((await svc.forUser(user(), 'open')).some((x) => x.id.startsWith('plan-')), false);
  plans.current = async () => { throw new Error('db down'); };
  assert.ok((await svc.forUser(user(), 'open')).length, 'a plan outage does not break notices');
});

test('usage notices warn near the limit and offer an upgrade unless already Ultra', async () => {
  let used = 900;
  const store = { tokensSince: async () => used };
  let plan = { plan: 'max', endsAt: new Date(NOW + 30 * 86_400_000).toISOString() };
  const plans = { current: async () => plan };
  const svc = createNotices({
    list: [],
    plans,
    store,
    config: { plans: { enabled: true }, limits: { userDailyTokens: 1000 }, professional: { enabled: true } },
    now: () => NOW
  });
  let items = await svc.forUser(user(), 'open');
  assert.equal(items[0].id, 'usage-near-chat-2026-10-10');
  assert.equal(items[0].type, 'warning');
  assert.deepEqual(items[0].action, { label: 'See plans', target: 'plans' });

  used = 1000;
  items = await svc.forUser(user(), 'open');
  assert.equal(items[0].id, 'usage-limit-chat-2026-10-10');
  assert.deepEqual(items[0].action, { label: 'Upgrade plan', target: 'plans' });

  plan = { plan: 'ultra', endsAt: new Date(NOW + 30 * 86_400_000).toISOString() };
  items = await svc.forUser(user(), 'open');
  assert.equal(items[0].action, null, 'Ultra has no higher plan to upgrade to');
});

test('settings: notice choices are checked; closing a notice is kept with the account', async () => {
  const calls = [];
  const fetchImpl = async (u, init) => { calls.push(JSON.parse(init.body)); return Response.json({ user_metadata: JSON.parse(init.body).data }); };
  const settings = createSettings({ url: 'https://p.supabase.co', anonKey: 'anon', fetchImpl });
  const me = user({ memory: true, seen: ['a'] });
  assert.deepEqual(await settings.update(me, 't', { notices: { tips: false } }), { memory: true, notices: { features: true, tips: false }, seen: ['a'], library: true, retention: null });
  for (const bad of [{ notices: { tips: 'no' } }, { notices: { security: false } }, { notices: {} }, { notices: [] }, { notices: null }]) {
    await assert.rejects(settings.update(me, 't', bad), /on or off/);
  }
  assert.deepEqual((await settings.dismiss(me, 't', 'feat-1')).seen, ['a', 'feat-1']);
  const before = calls.length;
  assert.deepEqual((await settings.dismiss(me, 't', 'a')).seen, ['a'], 'already closed: nothing is written');
  assert.equal(calls.length, before);
  await assert.rejects(settings.dismiss(me, 't', '../x'), /not valid/);
  await assert.rejects(settings.dismiss({ ...me, actor: { type: 'guest', id: 'g' } }, 't', 'x'), /Sign in/);
  const full = user({ seen: Array.from({ length: SEEN_MAX }, (_, i) => 'n' + i) });
  const after = (await settings.dismiss(full, 't', 'newest')).seen;
  assert.equal(after.length, SEEN_MAX);
  assert.equal(after.at(-1), 'newest');
  assert.equal(after[0], 'n1', 'the oldest is dropped');
});

test('notice routes: public list, a person’s own list, closing needs sign-in', async () => {
  const list = loadNotices([n('tip', { when: 'both' }), n('feat', { type: 'feature' }), n('mine', { audience: 'user', type: 'security' })], quiet);
  const notices = createNotices({ list, config: { professional: { enabled: true } } });
  const writes = [];
  const settings = createSettings({ url: 'https://p.supabase.co', anonKey: 'anon', fetchImpl: async (u, init) => { writes.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) }); return Response.json({ user_metadata: JSON.parse(init.body).data }); } });
  const built = buildTestApp({ verifyUser: async (t) => (t === USER_TOKEN ? { id: 'user-1', prefs: { notices: { features: false } } } : null), settings, notices });
  const { url, close } = await serve(built.app);
  const get = (p, t) => fetch(url + p, { headers: t ? bearer(t) : {} });
  try {
    assert.deepEqual((await (await get('/v1/notices')).json()).notices.map((x) => x.id), ['feat', 'tip']);
    assert.deepEqual((await (await get('/v1/notices?when=new_chat')).json()).notices.map((x) => x.id), ['tip']);
    assert.equal((await get('/v1/notices?when=both')).status, 400);
    assert.equal((await get('/v1/notices?when=<x>')).status, 400);

    assert.deepEqual((await (await get('/v1/notices/mine', USER_TOKEN)).json()).notices.map((x) => x.id), ['mine', 'tip'], 'feature news turned off');
    const guest = (await (await fetch(url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    assert.deepEqual((await (await get('/v1/notices/mine', guest)).json()).notices.map((x) => x.id), ['feat', 'tip']);
    assert.equal((await get('/v1/notices/mine', SECRET_KEY)).status, 403);
    assert.equal((await get('/v1/notices/mine')).status, 401);

    const post = (id, t) => fetch(url + '/v1/notices/' + id + '/dismiss', { method: 'POST', headers: t ? bearer(t) : {} });
    assert.equal((await post('tip', USER_TOKEN)).status, 200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].auth, 'Bearer ' + USER_TOKEN, 'saved with the person’s own token');
    assert.deepEqual(writes[0].body.data.nasrin_prefs.seen, ['tip']);
    assert.equal(writes[0].body.data.nasrin_prefs.notices.features, false, 'other choices are kept');
    assert.equal((await post('tip', guest)).status, 403);
    assert.equal((await post('tip')).status, 401);
    assert.equal((await post('bad_id', USER_TOKEN)).status, 400);
    assert.equal(writes.length, 1);
  } finally { await close(); }
});
