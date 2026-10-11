import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../src/store/supabase-store.js';
import { createSupabaseUserVerifier } from '../src/auth/supabase-user.js';
import { UpstreamError, HttpError } from '../src/http/errors.js';

// A fetch that records requests and answers from a script.
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, ...init });
    const { status = 200, body = [] } = typeof answer === 'function' ? answer(url, init) : answer;
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  f.calls = calls;
  return f;
}

test('store requests use the service key and validated ids only', async () => {
  const f = fakeFetch({ body: [{ id: 'aaaaaaaaaaaa', tenant_id: 't', kind: 'secret', secret_hash: 'h', scopes: ['chat'], allowed_origins: [], revoked_at: null }] });
  const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });

  const key = await store.getApiKey('aaaaaaaaaaaa');
  assert.equal(key.kind, 'secret');
  assert.equal(key.revoked, false);
  assert.match(f.calls[0].url, /^https:\/\/p\.supabase\.co\/rest\/v1\/api_keys\?id=eq\.aaaaaaaaaaaa&/);
  assert.equal(f.calls[0].headers.apikey, 'svc');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer svc');

  // anything that is not a well-formed id never reaches the database
  assert.equal(await store.getApiKey('aaaa&id=neq.x'), null);
  assert.equal(await store.getTenant('not-a-uuid'), null);
  assert.equal(f.calls.length, 1);
});

test('database failures become UpstreamError (shown to callers as a 503)', async () => {
  const down = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.getTenant('00000000-0000-0000-0000-000000000001'), UpstreamError);
  const err = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: fakeFetch({ status: 500, body: { message: 'boom' } }) });
  await assert.rejects(err.getTenant('00000000-0000-0000-0000-000000000001'), UpstreamError);
});

test('user check: valid, invalid, outage, and caching of valid answers', async () => {
  let n = 0;
  const f = fakeFetch((url, init) => {
    n += 1;
    if (init.headers.apikey !== 'anon') return { status: 401, body: {} };
    const token = init.headers.Authorization.slice(7);
    if (token === 'good.good.good') return { body: { id: 'u1' } };
    if (token === 'down.down.down') return { status: 502, body: {} };
    return { status: 401, body: {} };
  });
  const verify = createSupabaseUserVerifier({ url: 'https://p.supabase.co', publishableKey: 'anon', fetchImpl: f });

  assert.deepEqual(await verify('good.good.good'), { id: 'u1', prefs: { memory: null, notices: { features: true, tips: true }, seen: [], library: true, retention: null } });
  assert.deepEqual(await verify('good.good.good'), { id: 'u1', prefs: { memory: null, notices: { features: true, tips: true }, seen: [], library: true, retention: null } });
  assert.equal(n, 1, 'second check served from the short cache');
  verify.forget('good.good.good');
  await verify('good.good.good');
  assert.equal(n, 2, 'after a settings change the next check is fresh');
  assert.equal(f.calls[0].url, 'https://p.supabase.co/auth/v1/user');
  assert.equal(f.calls[0].headers.apikey, 'anon');

  assert.equal(await verify('bad.bad.bad'), null);
  await assert.rejects(verify('down.down.down'), (e) => e instanceof HttpError && e.status === 503);
  assert.equal(await verify('not a jwt'), null);
});

test('tenant read works before migration 011 (no knowledge_only column yet)', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const row = { id, kind: 'platform', status: 'active', daily_token_limit: 5 };
  const old = fakeFetch((url) => (url.includes('knowledge_only')
    ? { status: 400, body: { code: '42703', message: 'column tenants.knowledge_only does not exist' } }
    : { body: [row] }));
  const t = await createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: old }).getTenant(id);
  assert.deepEqual([t.id, t.knowledgeOnly, t.offTopicReply], [id, false, null]);
  assert.equal(old.calls.length, 2);

  const now = fakeFetch({ body: [{ ...row, knowledge_only: true, off_topic_reply: 'Only our services.' }] });
  const t2 = await createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: now }).getTenant(id);
  assert.deepEqual([t2.knowledgeOnly, t2.offTopicReply], [true, 'Only our services.']);

  const broken = fakeFetch({ status: 500, body: { message: 'boom' } });
  await assert.rejects(createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: broken }).getTenant(id), UpstreamError);
});


test('Supabase store uses the atomic global USD reservation RPCs and validates their results', async () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const f = fakeFetch((url, init) => {
    if (url.endsWith('/rpc/reserve_global_spend')) return { body: [{
      allowed: true, reason: null, reservation_id: id, daily_used: '0.01', weekly_used: '0.02', monthly_used: '0.03'
    }] };
    if (url.endsWith('/rpc/settle_global_spend')) return { body: true };
    if (url.endsWith('/rpc/release_global_spend')) return { body: true };
    if (url.endsWith('/rpc/usage_image_cost_since')) return { body: 0.02 };
    if (url.endsWith('/rpc/usage_cost_since')) return { body: 0.12 };
    return { body: [] };
  });
  const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });
  const reserved = await store.reserveGlobalSpend({
    reservationId: id, kind: 'reasoning', tenantId: '00000000-0000-0000-0000-000000000001',
    actorType: 'user', actorId: 'user-1', reservedUsd: 0.04,
    dailyLimit: 0.25, weeklyLimit: 1, monthlyLimit: 4, maxRequestUsd: 0.05
  });
  assert.deepEqual(reserved, {
    allowed: true, reason: null, reservationId: id, dailyUsed: 0.01, weeklyUsed: 0.02, monthlyUsed: 0.03
  });
  const reserveCall = f.calls.find((call) => call.url.endsWith('/rpc/reserve_global_spend'));
  assert.deepEqual(JSON.parse(reserveCall.body), {
    p_reservation_id: id, p_kind: 'reasoning', p_tenant: '00000000-0000-0000-0000-000000000001',
    p_actor_type: 'user', p_actor_id: 'user-1', p_reserved_usd: 0.04,
    p_daily_limit: 0.25, p_weekly_limit: 1, p_monthly_limit: 4, p_max_request_usd: 0.05
  });
  assert.equal(await store.settleGlobalSpendReservation({ reservationId: id, actualUsd: 0.02 }), true);
  assert.equal(await store.imageCostSince(new Date('2026-01-01T00:00:00Z')), 0.02);
  assert.equal(await store.costSince(new Date('2026-01-01T00:00:00Z')), 0.12);
});
